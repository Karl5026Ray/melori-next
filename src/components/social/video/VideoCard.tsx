"use client";

import { useState, useRef, useEffect } from "react";
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
}

export function VideoCard({ video, isActive }: VideoCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);
  const [likePending, setLikePending] = useState(false);
  const [commentsCount, setCommentsCount] = useState(video.comments_count);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const isAudio = video.media_type === "audio";

  // Load the caller's like state + the live count for this card. Runs once per
  // video id; logged-out users just get liked=false and the public count.
  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/social/videos/${video.id}/like`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setIsLiked(!!d.liked);
        if (typeof d.likesCount === "number") setLikesCount(d.likesCount);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [video.id]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isActive) {
      el.play().catch(() => {});
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [isActive]);

  // Audio posts: pause AND reset when they scroll out of view so the card is
  // ready to play from the top the next time it becomes active. Also reset the
  // playhead when a clip finishes, otherwise the native controls sit in the
  // "ended" state and tapping play does nothing (Bug: "won't stop on the
  // correct spot / then won't play").
  useEffect(() => {
    if (!isAudio) return;
    const el = audioRef.current;
    if (!el) return;

    const handleEnded = () => {
      el.pause();
      el.currentTime = 0;
    };
    el.addEventListener("ended", handleEnded);

    if (!isActive) {
      el.pause();
      el.currentTime = 0;
    }

    return () => {
      el.removeEventListener("ended", handleEnded);
    };
  }, [isActive, isAudio]);

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (videoRef.current) videoRef.current.muted = !isMuted;
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

  return (
    <div className="relative h-full w-full bg-melori-void">
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
            src={video.video_url}
            controls
            className="relative mt-6 w-full max-w-sm"
          />
        </div>
      ) : (
        <video
          ref={videoRef}
          src={video.video_url}
          loop
          muted={isMuted}
          playsInline
          className="absolute inset-0 h-full w-full object-contain"
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
        <button className="flex flex-col items-center gap-1 text-white">
          <Share2 className="w-7 h-7" />
          <span className="text-xs font-medium">Share</span>
        </button>
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
