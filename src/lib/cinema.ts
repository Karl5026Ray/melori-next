// Shared constants + helpers for MM Cinema.
//
// Cinema is a room FORMAT on the existing Spaces engine, not a separate
// product: a Cinema room is a `spaces` row with room_format = 'cinema'. It
// therefore inherits host/speaker/audience roles, the ordered raise-hand queue,
// moderation, room bans, and unified end-room teardown for free. What makes it
// Cinema is the shared, host-synced video surface on the stage.

import type { Space } from "@/types/social";

export const CINEMA_ROOM_FORMAT = "cinema" as const;

/**
 * Discover-screen filter tabs, in mockup order. "live now" is the default and
 * is NOT a genre — it means "don't filter", so it carries a null slug.
 */
export const CINEMA_GENRE_TABS: ReadonlyArray<{
  label: string;
  slug: string | null;
}> = [
  { label: "live now", slug: null },
  { label: "hip hop", slug: "hip-hop" },
  { label: "r&b", slug: "rnb" },
  { label: "afrobeats", slug: "afrobeats" },
  { label: "pop", slug: "pop" },
];

/**
 * Where a room's "back" / "leave" / "ended" exits should land.
 *
 * A Cinema room is a `spaces` row rendered by /social/spaces/[spaceId], so
 * every exit on that page used to be hardcoded to /social/spaces — which meant
 * entering from Cinema and being ejected into Spaces. Route the exit by format
 * instead, so people come back out where they went in.
 */
export function roomExitHref(
  roomFormat: string | null | undefined,
): string {
  return roomFormat === CINEMA_ROOM_FORMAT ? "/social/cinema" : "/social/spaces";
}

/** Matching link text for {@link roomExitHref}. */
export function roomExitLabel(
  roomFormat: string | null | undefined,
): string {
  return roomFormat === CINEMA_ROOM_FORMAT ? "Back to Cinema" : "Back to Spaces";
}

/**
 * Where to land after SCHEDULING a room for later. Spaces has a dedicated
 * scheduled tab; Cinema surfaces scheduled rooms in its STARTING SOON list on
 * the discover screen, so there's no tab to select.
 */
export function roomScheduledHref(
  roomFormat: string | null | undefined,
): string {
  return roomFormat === CINEMA_ROOM_FORMAT
    ? "/social/cinema"
    : "/social/spaces?tab=scheduled";
}

/** Narrows an arbitrary `?genre=` search param to a tab we actually render. */
export function resolveGenreParam(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = CINEMA_GENRE_TABS.find((tab) => tab.slug === raw);
  return match?.slug ?? null;
}

/**
 * "starts in 12 min" / "starts in 2 hr" / "starting now".
 *
 * The mockup's STARTING SOON rows are relative, not absolute — a countdown is
 * what makes someone set a reminder. Deliberately coarse: rounding to whole
 * minutes avoids a server-rendered value that's visibly stale by the time it
 * paints, and avoids implying second-level precision we don't have.
 */
export function formatStartsIn(scheduledAt: string | null | undefined): string {
  if (!scheduledAt) return "starting soon";
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return "starting soon";

  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "starting now";

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "starting now";
  if (minutes < 60) return `starts in ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `starts in ${hours} hr`;

  const days = Math.round(hours / 24);
  return `starts in ${days} day${days === 1 ? "" : "s"}`;
}

/** "214 watching" — the audience number the mockup leads with. */
export function formatWatching(count: number | null | undefined): string {
  const n = Math.max(0, count ?? 0);
  return `${n.toLocaleString()} watching`;
}

/**
 * Picks the room to feature at the top of discover: the live Cinema room with
 * the biggest audience. Returns the featured room and the remainder, so the
 * "LIVE NOW" grid below never repeats the featured card.
 */
export function pickFeatured(live: Space[]): {
  featured: Space | null;
  rest: Space[];
} {
  if (live.length === 0) return { featured: null, rest: [] };
  let featured = live[0];
  for (const room of live) {
    if ((room.participant_count ?? 0) > (featured.participant_count ?? 0)) {
      featured = room;
    }
  }
  return { featured, rest: live.filter((room) => room.id !== featured.id) };
}
