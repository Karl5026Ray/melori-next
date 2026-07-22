"use client";

// TikTok-style, full-screen Profile Scroller for melorimusic.org.
//
// One profile fills the viewport at a time. On mobile the user swipes
// vertically; on desktop we bind ArrowUp/ArrowDown/PageUp/PageDown/Home/End
// keys and the mouse wheel with throttling. Pagination is keyset via
// /api/profiles/feed and we prefetch the next page when the viewer is 3
// slides from the end. Filter chips at the top switch between "Newest",
// "Online now", "Artists only" and "Not following".
//
// Consumers open this at /social/discover or inside a modal via the
// exported <ProfileScroller /> — it manages its own auth check, empty state,
// and error states so the caller just drops it into a full-height flex box.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowUp,
  ChevronUp,
  ChevronDown,
  Loader2,
  MapPin,
  MessageCircle,
  RotateCcw,
  Sparkles,
  Sparkle,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import FollowButton from "@/components/social/FollowButton";

// --- types -----------------------------------------------------------------

type ProfileItem = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  banner_url: string | null;
  role: string;
  bio: string | null;
  city: string | null;
  verified: boolean;
  followers_count: number;
  following_count: number;
  created_at: string;
  last_seen_at: string | null;
};

type FeedResponse = {
  items: ProfileItem[];
  nextCursor: string | null;
  followingIds: string[];
  mode: "newest" | "online";
};

type Mode = "newest" | "online";
type RoleFilter = "all" | "artist";

type Filters = {
  mode: Mode;
  role: RoleFilter;
  excludeFollowed: boolean;
};

const DEFAULT_FILTERS: Filters = {
  mode: "newest",
  role: "all",
  excludeFollowed: false,
};

// --- helpers ---------------------------------------------------------------

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function isOnline(profile: ProfileItem): boolean {
  if (!profile.last_seen_at) return false;
  const seen = new Date(profile.last_seen_at).getTime();
  if (Number.isNaN(seen)) return false;
  return Date.now() - seen < ONLINE_WINDOW_MS;
}

function buildQuery(filters: Filters, cursor: string | null): string {
  const p = new URLSearchParams();
  p.set("mode", filters.mode);
  if (filters.role === "artist") p.set("role", "artist");
  if (filters.excludeFollowed) p.set("exclude_followed", "1");
  if (cursor) p.set("cursor", cursor);
  p.set("limit", "10");
  return p.toString();
}

// --- component -------------------------------------------------------------

export default function ProfileScroller() {
  const { user } = useAuth();

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<ProfileItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);

  // Ref for the scroll container. We do transform-based translation of
  // slides rather than native scroll snapping so keyboard + wheel + swipe
  // all funnel through the same "advance" primitive.
  const containerRef = useRef<HTMLDivElement>(null);

  // Load a page. When `reset` is true we replace state (used on filter
  // change); otherwise we append.
  const loadPage = useCallback(
    async (reset: boolean, currentFilters: Filters, currentCursor: string | null) => {
      if (loading) return;
      if (!reset && !hasMore) return;
      setLoading(true);
      setError(null);
      try {
        const qs = buildQuery(currentFilters, reset ? null : currentCursor);
        const res = await authFetch(`/api/profiles/feed?${qs}`);
        if (!res.ok) throw new Error(`Feed failed: ${res.status}`);
        const json = (await res.json()) as FeedResponse;

        if (reset) {
          setItems(json.items);
          setIndex(0);
          setFollowingIds(new Set(json.followingIds));
        } else {
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const merged = [...prev];
            for (const item of json.items) {
              if (!seen.has(item.id)) merged.push(item);
            }
            return merged;
          });
          setFollowingIds((prev) => {
            const next = new Set(prev);
            for (const id of json.followingIds) next.add(id);
            return next;
          });
        }
        setCursor(json.nextCursor);
        setHasMore(Boolean(json.nextCursor));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // stable so effects can call it without infinite loops
  );

  // Initial + filter-change load. Filters are stringified so shallow object
  // identity churn doesn't re-trigger us.
  const filtersKey = `${filters.mode}|${filters.role}|${filters.excludeFollowed}`;
  useEffect(() => {
    void loadPage(true, filters, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  // Prefetch next page when 3 slides from the end.
  useEffect(() => {
    if (!hasMore || loading) return;
    if (items.length - index <= 3) {
      void loadPage(false, filters, cursor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length, hasMore, loading, cursor]);

  // --- navigation primitives ----------------------------------------------

  // When the feed is exhausted (no more pages) and we have at least one
  // profile, we append a synthetic "You've caught up" slide at the end so a
  // swipe past the last real profile lands on something meaningful (retry /
  // reset filters) instead of a dead-end pip. `totalSlides` includes that
  // synthetic slide so all the nav clamps stay correct.
  const showEndCard = !hasMore && items.length > 0;
  const totalSlides = items.length + (showEndCard ? 1 : 0);

  const canGoUp = index > 0;
  const canGoDown = index < totalSlides - 1;

  // Fire a short haptic buzz on capable devices. Silent no-op elsewhere; the
  // try/catch guards against Permissions-Policy denials that would otherwise
  // throw and break the gesture chain.
  const buzz = (ms = 8) => {
    if (typeof navigator === "undefined") return;
    if (typeof navigator.vibrate !== "function") return;
    try { navigator.vibrate(ms); } catch { /* ignore */ }
  };

  const advance = useCallback(
    (delta: 1 | -1) => {
      setIndex((prev) => {
        const next = prev + delta;
        if (next < 0) return 0;
        if (next >= totalSlides) return totalSlides - 1;
        // Only buzz on actual movement (edge attempts stay silent so the
        // rubber-band + disabled-chevron cues do the talking).
        if (next !== prev) buzz(8);
        return next;
      });
    },
    [totalSlides],
  );

  // Keyboard: arrows + page + home/end. Ignored while typing in an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && ["INPUT", "TEXTAREA", "SELECT"].includes(tgt.tagName)) return;
      if (tgt && tgt.isContentEditable) return;
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "j") {
        e.preventDefault();
        advance(1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "k") {
        e.preventDefault();
        advance(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        setIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setIndex(totalSlides - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, totalSlides]);

  // Wheel: throttle so a single "flick" advances exactly one card. Also
  // guards against small trackpad drift by requiring |deltaY| > 20.
  const wheelLockRef = useRef<number>(0);
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(e.deltaY) < 20) return;
      const now = Date.now();
      if (now - wheelLockRef.current < 450) return;
      wheelLockRef.current = now;
      advance(e.deltaY > 0 ? 1 : -1);
    },
    [advance],
  );

  // Touch / pointer swipe. We use the pointer events API so it works for
  // touch, pen, and mouse-drag on desktop. The gesture is "vertical drag
  // over 20% of the viewport OR faster than 0.5px/ms" — matches the feel
  // people know from TikTok / Reels.
  const dragRef = useRef<{
    active: boolean;
    startY: number;
    startX: number;
    startT: number;
    pointerId: number;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = {
      active: true,
      startY: e.clientY,
      startX: e.clientX,
      startT: Date.now(),
      pointerId: e.pointerId,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    const dy = e.clientY - drag.startY;
    const dx = e.clientX - drag.startX;
    // Cancel drag if it's clearly horizontal (like a swipe on a nested carousel).
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 24) {
      dragRef.current = null;
      setDragOffset(0);
      return;
    }
    // Rubber-band at the edges.
    let clamped = dy;
    if ((!canGoUp && dy > 0) || (!canGoDown && dy < 0)) clamped = dy * 0.25;
    setDragOffset(clamped);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    dragRef.current = null;
    const dy = e.clientY - drag.startY;
    const dt = Math.max(1, Date.now() - drag.startT);
    const velocity = dy / dt;
    const viewportH =
      containerRef.current?.clientHeight ?? window.innerHeight ?? 800;
    const threshold = viewportH * 0.2;

    if ((dy < -threshold || velocity < -0.5) && canGoDown) {
      advance(1);
    } else if ((dy > threshold || velocity > 0.5) && canGoUp) {
      advance(-1);
    }
    setDragOffset(0);
  };

  // --- filter UI helpers --------------------------------------------------

  const setMode = (mode: Mode) => setFilters((f) => ({ ...f, mode }));
  const toggleRole = () =>
    setFilters((f) => ({ ...f, role: f.role === "artist" ? "all" : "artist" }));
  const toggleUnfollowed = () =>
    setFilters((f) => ({ ...f, excludeFollowed: !f.excludeFollowed }));

  const chipBase =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap";
  const chipOn =
    "border-melori-purple/60 bg-melori-purple/20 text-white";
  const chipOff =
    "border-melori-border bg-melori-elevated/70 text-melori-muted hover:text-white hover:border-melori-purple/40";

  // --- render -------------------------------------------------------------

  // Loading placeholder for the very first fetch.
  if (loading && items.length === 0) {
    return (
      <div className="relative flex h-full min-h-[70vh] w-full items-center justify-center bg-melori-void">
        <Loader2 className="h-8 w-8 animate-spin text-melori-muted" />
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="relative flex h-full min-h-[70vh] w-full flex-col items-center justify-center gap-3 bg-melori-void px-6 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <button
          type="button"
          onClick={() => void loadPage(true, filters, null)}
          className="rounded-full border border-melori-border bg-melori-elevated px-4 py-2 text-sm hover:border-melori-purple/40"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <div className="relative flex h-full min-h-[70vh] w-full flex-col items-center justify-center gap-3 bg-melori-void px-6 text-center">
        <Users className="h-10 w-10 text-melori-muted" />
        <p className="text-sm text-melori-muted">
          No profiles match these filters yet.
        </p>
        <button
          type="button"
          onClick={() => setFilters(DEFAULT_FILTERS)}
          className="rounded-full border border-melori-border bg-melori-elevated px-4 py-2 text-sm hover:border-melori-purple/40"
        >
          Reset filters
        </button>
      </div>
    );
  }

  const translatePercent = -(index * 100);
  const dragTranslatePx = dragOffset;

  return (
    <div className="relative flex h-full min-h-[70vh] w-full flex-col overflow-hidden bg-melori-void">
      {/* Filter chip row. Overlays the top so it stays visible over the current
          profile's banner. Horizontal scroll is intentional here (it's a
          contained chip strip, not the primary content axis). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-3 sm:pt-4">
        <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-melori-border/70 bg-black/50 px-2 py-1.5 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setMode("newest")}
            className={`${chipBase} ${filters.mode === "newest" ? chipOn : chipOff}`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Newest
          </button>
          <button
            type="button"
            onClick={() => setMode("online")}
            className={`${chipBase} ${filters.mode === "online" ? chipOn : chipOff}`}
          >
            <Wifi className="h-3.5 w-3.5" />
            Online
          </button>
          <button
            type="button"
            onClick={toggleRole}
            className={`${chipBase} ${filters.role === "artist" ? chipOn : chipOff}`}
          >
            Artists
          </button>
          {user && (
            <button
              type="button"
              onClick={toggleUnfollowed}
              className={`${chipBase} ${filters.excludeFollowed ? chipOn : chipOff}`}
            >
              Not following
            </button>
          )}
        </div>
      </div>

      {/* Slide track. We render EVERY loaded profile as its own full-viewport
          slide and translate the track vertically. Only the active slide's
          heavy content (banner image) is eager-loaded; neighbours are lazy. */}
      <div
        ref={containerRef}
        className="relative h-full w-full touch-none select-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="h-full w-full"
          style={{
            transform: `translate3d(0, calc(${translatePercent}% + ${dragTranslatePx}px), 0)`,
            transition: dragOffset === 0 ? "transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
          }}
        >
          {items.map((profile, i) => {
            const distance = Math.abs(i - index);
            const eager = distance <= 1;
            return (
              <ProfileSlide
                key={profile.id}
                profile={profile}
                eager={eager}
                initialFollowing={followingIds.has(profile.id)}
                onFollowChange={(following) => {
                  setFollowingIds((prev) => {
                    const next = new Set(prev);
                    if (following) next.add(profile.id);
                    else next.delete(profile.id);
                    return next;
                  });
                }}
              />
            );
          })}
          {showEndCard && (
            <EndOfFeedSlide
              onResetFilters={() => {
                setFilters(DEFAULT_FILTERS);
              }}
              onScrollTop={() => {
                setIndex(0);
                buzz(8);
              }}
              filtersActive={
                filters.mode !== DEFAULT_FILTERS.mode ||
                filters.role !== DEFAULT_FILTERS.role ||
                filters.excludeFollowed !== DEFAULT_FILTERS.excludeFollowed
              }
            />
          )}
        </div>
      </div>

      {/* Desktop nav arrows. Hidden on touch-primary devices via CSS.
          Keyboard users get the same effect via ArrowUp/ArrowDown. */}
      <div className="pointer-events-none absolute inset-y-0 right-2 z-20 hidden flex-col items-center justify-center gap-3 md:flex">
        <button
          type="button"
          onClick={() => advance(-1)}
          disabled={!canGoUp}
          aria-label="Previous profile"
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-melori-border bg-black/50 text-white backdrop-blur transition disabled:cursor-not-allowed disabled:opacity-30 hover:border-melori-purple/60 hover:bg-black/70"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => advance(1)}
          disabled={!canGoDown}
          aria-label="Next profile"
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-melori-border bg-black/50 text-white backdrop-blur transition disabled:cursor-not-allowed disabled:opacity-30 hover:border-melori-purple/60 hover:bg-black/70"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      </div>

      {/* Position pip. Small, non-intrusive, bottom-left. Hidden on the
          synthetic end-of-feed slide because there's nothing to count. */}
      {index < items.length && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-medium text-white/80 backdrop-blur">
          {index + 1} / {items.length}
          {hasMore ? "+" : ""}
        </div>
      )}
    </div>
  );
}

// --- end-of-feed slide -----------------------------------------------------

function EndOfFeedSlide({
  onResetFilters,
  onScrollTop,
  filtersActive,
}: {
  onResetFilters: () => void;
  onScrollTop: () => void;
  filtersActive: boolean;
}) {
  return (
    <div className="relative flex h-full min-h-[70vh] w-full flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* Ambient brand gradient so it feels like part of the feed, not a
          system error screen. */}
      <div className="absolute inset-0 bg-gradient-to-br from-melori-purple/25 via-melori-void to-brand-accent/20" />
      <div className="absolute inset-0 bg-melori-void/40" />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-melori-purple/25 ring-1 ring-melori-purple/40">
          <Sparkle className="h-8 w-8 text-melori-purple" />
        </div>
        <h3 className="text-2xl font-bold text-white">You&rsquo;re all caught up</h3>
        <p className="max-w-xs text-sm text-white/70">
          {filtersActive
            ? "That’s everyone matching these filters. Try widening the search or head back to the top."
            : "You’ve swiped through every profile. Check back soon — new members are joining daily."}
        </p>

        <div className="mt-2 flex flex-col items-center gap-2 sm:flex-row">
          {filtersActive && (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1.5 rounded-full bg-melori-purple px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-melori-purple/30 transition hover:bg-melori-purple/90"
            >
              <RotateCcw className="h-4 w-4" />
              Reset filters
            </button>
          )}
          <button
            type="button"
            onClick={onScrollTop}
            className="inline-flex items-center gap-1.5 rounded-full border border-melori-border bg-black/40 px-5 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:border-melori-purple/40"
          >
            <ArrowUp className="h-4 w-4" />
            Back to top
          </button>
        </div>
      </div>
    </div>
  );
}

// --- one slide -------------------------------------------------------------

function ProfileSlide({
  profile,
  eager,
  initialFollowing,
  onFollowChange,
}: {
  profile: ProfileItem;
  eager: boolean;
  initialFollowing: boolean;
  onFollowChange: (following: boolean) => void;
}) {
  const online = useMemo(() => isOnline(profile), [profile]);

  return (
    <div className="relative flex h-full min-h-[70vh] w-full items-end justify-center overflow-hidden">
      {/* Banner (or gradient fallback) fills the slide. */}
      <div className="absolute inset-0">
        {profile.banner_url ? (
          <Image
            src={profile.banner_url}
            alt=""
            fill
            sizes="100vw"
            priority={eager}
            loading={eager ? "eager" : "lazy"}
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-brand-primary/40 via-melori-purple/25 to-brand-accent/40" />
        )}
        {/* Dim so the text below is legible on any banner. */}
        <div className="absolute inset-0 bg-gradient-to-t from-melori-void via-melori-void/70 to-transparent" />
      </div>

      {/* Foreground content. Max-width keeps desktop from stretching the card
          absurdly wide while still being full-screen on mobile. */}
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center px-5 pb-24 md:pb-16">
        <div className="relative mb-4">
          <img
            src={profile.avatar_url || "/favicon.png"}
            alt={profile.display_name}
            className="h-28 w-28 rounded-full border-4 border-melori-void object-cover shadow-xl md:h-32 md:w-32"
          />
          {online && (
            <span
              aria-label="Online now"
              className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-melori-void bg-emerald-400"
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <h2 className="text-center text-2xl font-bold text-white md:text-3xl">
            {profile.display_name}
          </h2>
          {profile.verified && (
            <span className="rounded-full bg-melori-purple/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-melori-purple">
              Verified
            </span>
          )}
        </div>

        <p className="mt-0.5 text-sm text-melori-muted">
          @{profile.username}{" "}
          <span className="mx-1 opacity-50">·</span>
          <span className="capitalize text-melori-purple">{profile.role}</span>
        </p>

        {profile.bio && (
          <p className="mt-3 max-w-md text-center text-sm leading-relaxed text-white/85">
            {profile.bio}
          </p>
        )}

        {profile.city && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-melori-muted">
            <MapPin className="h-3.5 w-3.5" />
            {profile.city}
          </p>
        )}

        <div className="mt-4 flex gap-6 text-sm text-white/80">
          <span>
            <span className="font-bold text-white">{profile.followers_count}</span>{" "}
            <span className="text-melori-muted">Followers</span>
          </span>
          <span>
            <span className="font-bold text-white">{profile.following_count}</span>{" "}
            <span className="text-melori-muted">Following</span>
          </span>
        </div>

        <div className="mt-6 flex items-center gap-2">
          <FollowButton
            targetId={profile.id}
            initialFollowing={initialFollowing}
            onChange={(following) => onFollowChange(following)}
            className="rounded-full bg-melori-purple px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-melori-purple/30 transition hover:bg-melori-purple/90"
          />
          <Link
            href={`/social/profile/${profile.username}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-melori-border bg-black/40 px-5 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:border-melori-purple/40"
          >
            <UserPlus className="h-4 w-4" />
            View
          </Link>
          <Link
            href={`/social/messages?to=${profile.id}`}
            aria-label={`Message ${profile.display_name}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-melori-border bg-black/40 text-white backdrop-blur transition hover:border-melori-purple/40"
          >
            <MessageCircle className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
