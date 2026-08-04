// Shared types + formatting for MM Cinema.
//
// Cinema is the "sit down and watch" surface: scheduled premieres, concert
// films, documentaries, and synced watch parties. It deliberately does not
// overlap Mirror (short-form vertical, 24h rotation) or MM Faces (live camera
// rooms) — those are lean-forward, this is lean-back.

export type CinemaStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "available"
  | "ended";

export type CinemaAccessTier = "free" | "superfan" | "ticketed";

export type CinemaScreening = {
  id: string;
  title: string;
  synopsis: string | null;
  poster_url: string | null;
  runtime_seconds: number | null;
  status: CinemaStatus;
  starts_at: string | null;
  is_watch_party: boolean;
  access_tier: CinemaAccessTier;
  artist: { id: string; display_name: string | null; avatar_url: string | null } | null;
};

/** "1h 42m" / "48m" / "Runtime TBA" */
export function formatRuntime(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "Runtime TBA";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Short, member-facing start time. Uses the viewer's locale/zone via
 * `toLocaleString`, so this must only run where that's acceptable — the shelf
 * renders server-side, so times show in the server zone until the screening
 * detail view (client) re-renders them. Kept intentionally coarse for that
 * reason: no seconds, no zone abbreviation to be wrong about.
 */
export function formatStartsAt(startsAt: string | null): string {
  if (!startsAt) return "Date TBA";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "Date TBA";
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
