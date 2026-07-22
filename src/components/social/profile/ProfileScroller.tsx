"use client";

// Facebook / news-feed–style Profile Feed for melorimusic.org.
//
// Profiles flow in a normal, natively-scrolling vertical column of rounded
// cards — NOT the old one-slide-per-screen TikTok snap. That model kept
// breaking on mobile: it drove a JS `translate3d(%)` track, depended on a
// resolved parent `h-full`/`100dvh` height, and rendered each banner as a
// full-viewport `object-cover` fill that cropped/mis-oriented on portrait
// phones. Native document scroll with self-sizing cards removes all three
// failure modes: there is no viewport-height coupling to get wrong, and each
// card's media is bounded by a fixed aspect-ratio box so portrait/landscape
// images never stretch or rotate.
//
// Data behaviour is unchanged: keyset pagination via /api/profiles/feed,
// the "Newest / Online / Artists / Not following" filter chips, and the
// "You're all caught up" end state. Infinite scroll is driven by an
// IntersectionObserver sentinel near the bottom of the list.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowUp,
  Loader2,
  MapPin,
  MessageCircle,
  RotateCcw,
  Sparkle,
  Sparkles,
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

// Fire a short haptic buzz on capable devices. Silent no-op elsewhere; the
// try/catch guards against Permissions-Policy denials that would otherwise
// throw.
function buzz(ms = 8) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try { navigator.vibrate(ms); } catch { /* ignore */ }
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

  const sentinelRef = useRef<HTMLDivElement>(null);

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

  // Keyset infinite scroll — load the next page when the sentinel scrolls into
  // view (relative to the document viewport). `rootMargin` fetches ~2 screens
  // ahead so the reader rarely sees the spinner.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadPage(false, filters, cursor);
        }
      },
      { rootMargin: "1200px 0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, cursor, filtersKey]);

  const showEndCard = !hasMore && items.length > 0;
  const filtersActive =
    filters.mode !== DEFAULT_FILTERS.mode ||
    filters.role !== DEFAULT_FILTERS.role ||
    filters.excludeFollowed !== DEFAULT_FILTERS.excludeFollowed;

  // --- filter UI helpers --------------------------------------------------

  const setMode = (mode: Mode) => {
    buzz(6);
    setFilters((f) => ({ ...f, mode }));
  };
  const toggleRole = () => {
    buzz(6);
    setFilters((f) => ({ ...f, role: f.role === "artist" ? "all" : "artist" }));
  };
  const toggleUnfollowed = () => {
    buzz(6);
    setFilters((f) => ({ ...f, excludeFollowed: !f.excludeFollowed }));
  };

  const chipBase =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap";
  const chipOn = "border-melori-purple/60 bg-melori-purple/20 text-white";
  const chipOff =
    "border-melori-border bg-melori-elevated/70 text-melori-muted hover:text-white hover:border-melori-purple/40";

  // --- render -------------------------------------------------------------

  const filterBar = (
    // Sticky so filters stay reachable as the feed scrolls. Sits just under
    // the 4rem site header.
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-melori-border/50 bg-melori-void/80 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex items-center gap-2 overflow-x-auto">
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
  );

  // The feed column: a centred, max-width reading column that grows with its
  // content and scrolls with the document. No viewport-height math.
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-8 sm:px-6">
      {filterBar}

      {/* First-load spinner. */}
      {loading && items.length === 0 && (
        <div className="flex min-h-[40svh] w-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-melori-muted" />
        </div>
      )}

      {/* Hard error on an empty feed. */}
      {error && items.length === 0 && (
        <div className="flex min-h-[40svh] w-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => void loadPage(true, filters, null)}
            className="rounded-full border border-melori-border bg-melori-elevated px-4 py-2 text-sm hover:border-melori-purple/40"
          >
            Try again
          </button>
        </div>
      )}

      {/* No matches for the current filters. */}
      {!loading && !error && items.length === 0 && (
        <div className="flex min-h-[40svh] w-full flex-col items-center justify-center gap-3 px-6 text-center">
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
      )}

      {/* The cards. */}
      {items.length > 0 && (
        <div className="flex flex-col gap-4">
          {items.map((profile, i) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              // Eager-load only the first couple of banners; the rest lazy-load
              // as they approach the viewport.
              eager={i < 2}
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
          ))}

          {/* Loading-more spinner while a subsequent page fetches. */}
          {loading && items.length > 0 && (
            <div className="flex w-full items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-melori-muted" />
            </div>
          )}

          {/* Infinite-scroll trigger. */}
          {hasMore && <div ref={sentinelRef} className="h-1 w-full" />}

          {/* End-of-feed card. */}
          {showEndCard && (
            <EndOfFeedCard
              filtersActive={filtersActive}
              onResetFilters={() => setFilters(DEFAULT_FILTERS)}
              onScrollTop={() => {
                buzz(8);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// --- end-of-feed card ------------------------------------------------------

function EndOfFeedCard({
  onResetFilters,
  onScrollTop,
  filtersActive,
}: {
  onResetFilters: () => void;
  onScrollTop: () => void;
  filtersActive: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-melori-border bg-melori-elevated px-6 py-10 text-center">
      <div className="absolute inset-0 bg-gradient-to-br from-melori-purple/20 via-transparent to-brand-accent/15" />
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-melori-purple/25 ring-1 ring-melori-purple/40">
          <Sparkle className="h-7 w-7 text-melori-purple" />
        </div>
        <h3 className="text-xl font-bold text-white">You&rsquo;re all caught up</h3>
        <p className="max-w-xs text-sm text-white/70">
          {filtersActive
            ? "That’s everyone matching these filters. Try widening the search or head back to the top."
            : "You’ve seen every profile. Check back soon — new members are joining daily."}
        </p>
        <div className="mt-1 flex flex-col items-center gap-2 sm:flex-row">
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

// --- one card --------------------------------------------------------------

function ProfileCard({
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
  const profileHref = `/social/profile/${profile.username}`;

  return (
    <article className="overflow-hidden rounded-2xl border border-melori-border bg-melori-elevated shadow-sm">
      {/* Banner. A FIXED aspect-ratio box bounds the media so portrait or
          landscape images are always cropped to fit (object-cover) and can
          never stretch or rotate. */}
      <Link href={profileHref} aria-label={`Open ${profile.display_name}'s profile`}>
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-melori-void sm:aspect-[5/2]">
          {profile.banner_url ? (
            <Image
              src={profile.banner_url}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 36rem"
              priority={eager}
              loading={eager ? "eager" : "lazy"}
              className="object-cover"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-brand-primary/40 via-melori-purple/25 to-brand-accent/40" />
          )}
        </div>
      </Link>

      {/* Content. The avatar overlaps the banner (Facebook-style) via a
          negative top margin. */}
      <div className="px-4 pb-4 sm:px-5">
        <div className="-mt-10 flex items-end gap-3">
          <Link href={profileHref} className="relative shrink-0">
            <img
              src={profile.avatar_url || "/favicon.png"}
              alt={profile.display_name}
              className="h-20 w-20 rounded-full border-4 border-melori-elevated object-cover shadow-lg"
            />
            {online && (
              <span
                aria-label="Online now"
                className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full border-2 border-melori-elevated bg-emerald-400"
              />
            )}
          </Link>

          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-center gap-2">
              <Link
                href={profileHref}
                className="truncate text-lg font-bold text-white hover:underline"
              >
                {profile.display_name}
              </Link>
              {profile.verified && (
                <span className="shrink-0 rounded-full bg-melori-purple/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-melori-purple">
                  Verified
                </span>
              )}
            </div>
            <p className="truncate text-sm text-melori-muted">
              @{profile.username}
              <span className="mx-1 opacity-50">·</span>
              <span className="capitalize text-melori-purple">{profile.role}</span>
            </p>
          </div>
        </div>

        {profile.bio && (
          <p className="mt-3 text-sm leading-relaxed text-white/85">
            {profile.bio}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white/80">
          <span>
            <span className="font-bold text-white">{profile.followers_count}</span>{" "}
            <span className="text-melori-muted">Followers</span>
          </span>
          <span>
            <span className="font-bold text-white">{profile.following_count}</span>{" "}
            <span className="text-melori-muted">Following</span>
          </span>
          {profile.city && (
            <span className="inline-flex items-center gap-1 text-xs text-melori-muted">
              <MapPin className="h-3.5 w-3.5" />
              {profile.city}
            </span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <FollowButton
            targetId={profile.id}
            initialFollowing={initialFollowing}
            onChange={(following) => onFollowChange(following)}
            className="rounded-full bg-melori-purple px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-melori-purple/30 transition hover:bg-melori-purple/90"
          />
          <Link
            href={profileHref}
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
    </article>
  );
}
