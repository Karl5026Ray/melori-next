// Turns a profile's last_seen_at (presence heartbeat) into a header label.

// Same window as /api/mirror/live (ONLINE_WINDOW_MS) so "Online now" on the
// inbox and "Active now" here agree.
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function describePresence(
  lastSeenAt: string | null | undefined,
  now: number,
): { online: boolean; label: string | null } {
  if (!lastSeenAt) return { online: false, label: null };
  const age = now - new Date(lastSeenAt).getTime();
  if (Number.isNaN(age)) return { online: false, label: null };
  if (age <= ONLINE_WINDOW_MS) return { online: true, label: "Active now" };
  const mins = Math.floor(age / 60_000);
  if (mins < 60) return { online: false, label: `Active ${mins}m ago` };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { online: false, label: `Active ${hours}h ago` };
  return { online: false, label: null };
}
