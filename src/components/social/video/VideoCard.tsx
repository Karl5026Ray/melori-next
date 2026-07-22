"use client";

import { useState, useRef, useEffect, memo } from "react";
import Link from "next/link";
import { SocialVideo } from "@/types/social";
import { authFetch } from "@/lib/authClient";
import CommentSheet from "./CommentSheet";
import {
  Heart,
  MessageCircle,
  Share2,
  Music,
  Volume2,
  VolumeX,
} from "lucide-react";

interface VideoCardProps {
  video: SocialVideo;
  isActive: boolean;
  // Distance (in cards) from the currently-active card. 0 = active, 1 =
  // immediate neighbour, etc. Used to decide when it is safe to fully reset a
  // paused video's playhead without causing a reload-flash if the user flicks
  // straight back to it.
  distance?: number;
}

// Resolve a media URL to something the browser can actually load. Video posts
// store full https URLs, but audio posts historically stored a BARE Supabase
// storage object path (e.g. "artist/album/01-track.mp3") which the <audio>
// element resolved relative to the page — producing a 404 HTML response and the
// "Unable to play media" error. The rows have been migrated to full URLs, but
// this stays as a defensive guard so any future bare path (audio only) still
// plays. Guarded on `isAudioType` so a bare VIDEO path is never mis-prefixed
// with the audio bucket.
function resolveMediaUrl(url: string, isAudioType: boolean): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url; // already a full URL
  if (!isAudioType) return url; // don't guess a bucket for non-audio
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const path = url.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/audio-files/${path}`;
}

function VideoCardBase({ video, isActive, distance = 99 }: VideoCardProps) {
  const isAudio = video.media_type === "audio";
  const mediaUrl = resolveMediaUrl(video.video_url, isAudio);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Video posts default muted (TikTok autoplay pattern — browsers block
  // autoplay-with-sound). Audio-only posts default UNMUTED: a muted audio post
  // is pointless, and the native <audio controls> bar is the manual fallback
  // if the browser blocks unmuted autoplay.
  const [isMuted, setIsMuted] = useState(!isAudio);
  // For audio posts: true when the browser BLOCKED unmuted autoplay so we fell
  // back to muted (or paused). Drives a "tap to play with sound" affordance.
  const [needsUnmuteTap, setNeedsUnmuteTap] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [likePending, setLikePending] = useState(false);
  const [commentsCount, setCommentsCount] = useState(video.comments_count);
  const [commentsOpen, setCommentsOpen] = useState(false);

  // Double-tap-to-like state.
  //
  // - `bursts` renders one <Heart> per double-tap at the tap point, keyed by an
  //   ever-increasing id so React never reuses a DOM node and every animation
  //   plays clean. Each burst auto-cleans after the animation window.
  // - `lastTapRef` remembers the previous tap so we can detect a double-tap
  //   within 300ms and within ~40px of the first tap (native double-tap feel,
  //   independent of the browser's own dblclick which behaves poorly on touch).
  const [bursts, setBursts] = useState<
    { id: number; x: number; y: number }[]
  >([]);
  const burstIdRef = useRef(0);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  // Share button state — shows a brief "Copied!" confirmation when we fall
  // back to the clipboard on desktops without navigator.share.
  const [shareCopied, setShareCopied] = useState(false);

  // Load the caller's like state + the live count for this card. Deferred until
  // the card is at (or adjacent to) the active position, and fetched only once.
  // Previously this fired on mount for EVERY card, so scrolling and infinite
  // scroll spawned a request storm of like-lookups for off-screen cards. We now
  // fetch lazily and remember we've done it via `likeLoadedRef`.
  const likeLoadedRef = useRef(false);
  useEffect(() => {
    if (likeLoadedRef.current) return;
    // Only load for the active card or its immediate neighbours.
    if (distance > 1) return;
    likeLoadedRef.current = true;
    let cancelled = false;
    authFetch(`/api/social/videos/${video.id}/like`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setIsLiked(!!d.liked);
        if (typeof d.likesCount === "number") setLikesCount(d.likesCount);
      })
      .catch(() => {
        // Allow a retry on a later pass if this attempt failed.
        likeLoadedRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [video.id, distance]);

  // Drive playback for the ACTIVE media element (video OR audio). Browsers block
  // autoplay-with-sound, so we always start muted and rely on the user's
  // mute toggle (a user gesture) to unmute. Audio posts auto-start here too so
  // the "music frames" play on scroll without needing the native play button.
  //
  // IMPORTANT: this effect depends ONLY on `isActive`/`isAudio` — NOT on
  // `distance` or `isMuted`. `distance` changes on every scroll tick, and if
  // playback were re-driven (or a cleanup pause fired) on each change, the
  // active audio/video would stutter and, for <audio>, effectively never play.
  useEffect(() => {
    const el = isAudio ? audioRef.current : videoRef.current;
    if (!el) return;

    if (!isActive) {
      el.pause();
      return;
    }

    if (!isAudio) {
      // Video: always starts muted (handled by state), just play.
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      return;
    }

    // Audio post: try to autoplay UNMUTED (product requirement). Browsers block
    // autoplay-with-sound without a prior user gesture, so if the unmuted play()
    // rejects we fall back to muted autoplay (a silent-but-live player is better
    // than a dead one, and it builds Chrome's media-engagement score) and raise
    // a "tap to play with sound" affordance. Once the user has interacted the
    // browser lets sound through and the tap clears the flag.
    let cancelled = false;
    el.muted = false;
    setIsMuted(false);
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        if (!cancelled) setNeedsUnmuteTap(false);
      }).catch(() => {
        if (cancelled) return;
        // Unmuted autoplay blocked — retry muted so the clip still runs.
        el.muted = true;
        setIsMuted(true);
        setNeedsUnmuteTap(true);
        const p2 = el.play();
        if (p2 && typeof p2.catch === "function") p2.catch(() => {});
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isActive, isAudio]);

  // Playhead reset is its OWN effect, decoupled from play/pause. Only rewind a
  // paused card once it is far (>1 card) from active — rewinding an adjacent
  // card would force a reload-from-scratch (black flash) if the user flicks
  // straight back to it.
  useEffect(() => {
    if (isActive) return;
    const el = isAudio ? audioRef.current : videoRef.current;
    if (!el) return;
    if (distance > 1) el.currentTime = 0;
  }, [isActive, isAudio, distance]);

  // Pause on UNMOUNT only (empty deps) so React 19 Strict-Mode remounts and
  // infinite-scroll unmounts can't leave ghost audio playing. This does NOT run
  // on every scroll, so it never interrupts the active clip.
  useEffect(() => {
    return () => {
      videoRef.current?.pause();
      audioRef.current?.pause();
    };
  }, []);

  // Audio posts: reset the playhead when a clip finishes, otherwise the native
  // controls sit in the "ended" state and tapping play does nothing (Bug:
  // "won't stop on the correct spot / then won't play").
  useEffect(() => {
    if (!isAudio) return;
    const el = audioRef.current;
    if (!el) return;

    const handleEnded = () => {
      el.pause();
      el.currentTime = 0;
    };
    el.addEventListener("ended", handleEnded);
    return () => {
      el.removeEventListener("ended", handleEnded);
    };
  }, [isAudio]);

  // Keep the imperative `muted` property in sync with React state for BOTH
  // media elements. The <video muted={...}> attribute is unreliable after
  // hydration in React, so we set the DOM property directly here.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
    if (audioRef.current) audioRef.current.muted = isMuted;
  }, [isMuted]);

  // Toggle mute using the functional updater so we never read stale `isMuted`.
  // Unmuting here is a genuine user gesture, so the browser will allow audible
  // playback. We also (re)start playback in case the element was paused.
  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      const el = isAudio ? audioRef.current : videoRef.current;
      if (el) {
        el.muted = next;
        if (!next) {
          // Unmuting is a genuine user gesture, so playback is now allowed and
          // any "tap to play with sound" prompt can go away.
          setNeedsUnmuteTap(false);
          const p = el.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      }
      return next;
    });
  };

  // Persisted like toggle. Optimistically flip the UI, POST to the API, then
  // reconcile with the authoritative count. On failure or 401, roll back.
  const handleLike = async () => {
    if (likePending) return;
    const prevLiked = isLiked;
    const prevCount = likesCount;
    setLikePending(true);
    setIsLiked(!prevLiked);
    setLikesCount((c) => (prevLiked ? c - 1 : c + 1));
    try {
      const res = await authFetch(`/api/social/videos/${video.id}/like`, {
        method: "POST",
      });
      if (!res.ok) {
        // 401 (signed out) or error → revert.
        setIsLiked(prevLiked);
        setLikesCount(prevCount);
        if (res.status === 401) window.location.href = "/social/auth";
        return;
      }
      const data = await res.json();
      setIsLiked(!!data.liked);
      if (typeof data.likesCount === "number") setLikesCount(data.likesCount);
    } catch {
      setIsLiked(prevLiked);
      setLikesCount(prevCount);
    } finally {
      setLikePending(false);
    }
  };

  // Share this post. Prefers the native share sheet (mobile / newer
  // desktops), falls back to clipboard so desktop users still get a link.
  // Silent on user-cancelled shares (AbortError) so the console stays clean.
  const handleShare = async () => {
    // vibrate() is a no-op on desktops; on phones it gives the same 10ms tap
    // the double-tap-like uses, keeping the whole card gesture set cohesive.
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try { navigator.vibrate(10); } catch { /* iOS Safari denies quietly */ }
    }

    // Absolute URL so the share target opens the post on any device. We use
    // the user's profile as the deep-link because Mirror posts don't yet
    // have a per-post canonical page; the profile shows their content.
    const origin = typeof window !== "undefined" ? window.location.origin : "https://melorimusic.org";
    const url = video.user?.username
      ? `${origin}/social/profile/${video.user.username}`
      : `${origin}/social/mirror`;
    const title = video.title
      ? `${video.title} · Melori Mirror`
      : "Melori Mirror";
    const text = video.user?.display_name
      ? `Check out ${video.user.display_name} on Melori`
      : "Check this out on Melori";

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title, text, url });
        return;
      }
    } catch (err) {
      // AbortError = user closed the share sheet; treat as success (no fallback).
      if (err instanceof Error && err.name === "AbortError") return;
    }

    // Fallback: copy the URL and flash a "Copied!" label for 1.6s.
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 1600);
      }
    } catch {
      /* clipboard denied; silent — nothing better we can do here */
    }
  };

  // Spawn a heart burst at (x, y) — coordinates are relative to the tap
  // surface, so the caller passes clientX/Y minus the surface's bounding
  // rect. Each burst self-cleans after 900ms (matches the animation length
  // in globals.css: `.mirror-heart-burst`).
  const spawnBurst = (x: number, y: number) => {
    const id = ++burstIdRef.current;
    setBursts((prev) => [...prev, { id, x, y }]);
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
    }, 900);
  };

  // Double-tap gesture: TikTok/Instagram-style. A second tap within 300ms
  // and ~40px of the first tap fires a LIKE (never an unlike — this matches
  // native app behaviour and prevents an accidental double-tap from wiping a
  // previous like) and plays a heart burst at the tap point.
  //
  // We implement this manually rather than using onDoubleClick because the
  // browser's synthetic dblclick event has a ~200ms delay on the *first* tap
  // too (waiting to see if a second tap arrives) — that would delay any
  // future single-tap handler we add here. Manual detection keeps single-tap
  // handlers (e.g. play/pause) instant.
  const handleTapSurface = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only respond to primary touches / left mouse. Ignore right-click, pen
    // eraser, etc.
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const prev = lastTapRef.current;

    if (
      prev &&
      now - prev.t < 300 &&
      Math.abs(prev.x - x) < 40 &&
      Math.abs(prev.y - y) < 40
    ) {
      // It's a double-tap: fire the burst, and if not already liked, like.
      lastTapRef.current = null; // consume so a third tap starts fresh
      spawnBurst(x, y);
      // Short haptic buzz on capable devices (Android + some newer iOS).
      // Silent no-op elsewhere; wrapped so a permissions policy denial can't
      // throw and break the gesture.
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try { navigator.vibrate(15); } catch { /* denied — ignore */ }
      }
      if (!isLiked && !likePending) {
        void handleLike();
      }
      return;
    }

    lastTapRef.current = { t: now, x, y };
  };

  return (
    <div
      className="relative h-full w-full bg-melori-void"
      onPointerDown={handleTapSurface}
    >
      {isAudio ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
          <div className="absolute inset-0 bg-gradient-to-br from-melori-purple/30 via-melori-void to-melori-pink/20" />
          {video.thumbnail_url ? (
            <img
              src={video.thumbnail_url}
              alt=""
              className="relative w-56 h-56 max-w-[70vw] max-h-[70vw] rounded-2xl object-cover shadow-2xl"
            />
          ) : (
            <div className="relative w-56 h-56 max-w-[70vw] max-h-[70vw] rounded-2xl bg-gradient-to-br from-melori-purple to-melori-pink flex items-center justify-center shadow-2xl">
              <Music className="w-20 h-20 text-white/80" />
            </div>
          )}
          <audio
            ref={audioRef}
            src={mediaUrl}
            controls
            // metadata only: full tracks can be several MB; we don't want a
            // scroll through the feed to eagerly pull every track.
            preload="metadata"
            className="relative mt-6 w-full max-w-sm"
          />

          {/* If the browser blocked unmuted autoplay, offer an explicit
              tap-to-play-with-sound button (a real <button>, so the click
              counts as the user gesture that unblocks audible playback). */}
          {needsUnmuteTap && (
            <button
              onClick={toggleMute}
              className="relative mt-4 flex items-center gap-2 rounded-full bg-white/90 px-5 py-2.5 font-semibold text-melori-void shadow-lg"
            >
              <Volume2 className="h-5 w-5" />
              Tap to play with sound
            </button>
          )}
        </div>
      ) : (
        <video
          ref={videoRef}
          src={mediaUrl}
          loop
          muted={isMuted}
          playsInline
          // Only fetch metadata until the card is active; the poster covers the
          // frame until the stream is ready, so we never flash a wrong/black
          // frame during a fast scroll.
          preload={isActive ? "auto" : "metadata"}
          // Content is predominantly portrait, so object-cover fills the frame
          // edge-to-edge (the TikTok look) with virtually no crop. object-top
          // biases any crop on the occasional landscape clip toward keeping the
          // top of the frame, and object-center keeps portrait clips centered.
          className="absolute inset-0 h-full w-full bg-black object-cover object-center"
          poster={video.thumbnail_url || undefined}
        />
      )}

      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60 pointer-events-none" />

      {!isAudio && (
        <button
          onClick={toggleMute}
          className="absolute top-4 right-4 p-2 bg-black/30 backdrop-blur rounded-full text-white"
        >
          {isMuted ? (
            <VolumeX className="w-5 h-5" />
          ) : (
            <Volume2 className="w-5 h-5" />
          )}
        </button>
      )}

      <div className="absolute bottom-28 md:bottom-20 left-4 right-20 text-white">
        <div className="flex items-center gap-2 mb-2">
          {video.user?.username ? (
            <Link
              href={`/social/profile/${video.user.username}`}
              className="flex items-center gap-2 transition-opacity hover:opacity-80"
            >
              <img
                src={video.user?.avatar_url || "/favicon.png"}
                className="w-8 h-8 rounded-full border border-white/30 object-cover"
                alt=""
              />
              <span className="font-semibold text-sm">
                @{video.user?.display_name || video.user?.username}
              </span>
            </Link>
          ) : (
            <>
              <img
                src={video.user?.avatar_url || "/favicon.png"}
                className="w-8 h-8 rounded-full border border-white/30 object-cover"
                alt=""
              />
              <span className="font-semibold text-sm">
                @{video.user?.display_name}
              </span>
            </>
          )}
          {video.user?.role && (
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full capitalize">
              {video.user?.role}
            </span>
          )}
        </div>
        <h3 className="font-bold text-lg mb-1">{video.title}</h3>
        <p className="text-sm text-white/80 line-clamp-2">
          {video.description}
        </p>
        <div className="flex items-center gap-2 mt-3 text-xs text-white/70">
          <Music className="w-4 h-4" />
          <span>Original Sound — {video.user?.display_name}</span>
        </div>
      </div>

      <div className="absolute right-4 bottom-28 md:bottom-20 flex flex-col items-center gap-6">
        <button
          onClick={handleLike}
          className="flex flex-col items-center gap-1 text-white"
        >
          <Heart
            className={`w-7 h-7 ${
              isLiked ? "fill-red-500 text-red-500" : ""
            }`}
          />
          <span className="text-xs font-medium">{likesCount}</span>
        </button>
        <button
          onClick={() => setCommentsOpen(true)}
          className="flex flex-col items-center gap-1 text-white"
        >
          <MessageCircle className="w-7 h-7" />
          <span className="text-xs font-medium">{commentsCount}</span>
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="flex flex-col items-center gap-1 text-white"
        >
          <Share2 className="w-7 h-7" />
          <span className="text-xs font-medium">
            {shareCopied ? "Copied!" : "Share"}
          </span>
        </button>
      </div>

      {/* Heart-burst layer. Absolutely positioned so it floats above the
          video and gradient overlay but stays below the right-rail actions
          and comment sheet. `pointer-events-none` so the bursts never eat a
          subsequent tap. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {bursts.map((b) => (
          <Heart
            key={b.id}
            aria-hidden
            className="mirror-heart-burst absolute h-24 w-24 fill-red-500 text-red-500 drop-shadow-[0_0_14px_rgba(255,0,80,0.55)]"
            style={{
              // Center the 96px heart on the tap point.
              left: b.x - 48,
              top: b.y - 48,
            }}
          />
        ))}
      </div>

      <CommentSheet
        videoId={video.id}
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        onCountChange={setCommentsCount}
      />
    </div>
  );
}

// Memoized so growing the feed array during infinite scroll doesn't re-render
// every already-mounted card (only cards whose isActive/distance actually
// change re-render). This removes the layout-thrash that contributed to the
// mid-scroll "jump".
export const VideoCard = memo(VideoCardBase);
