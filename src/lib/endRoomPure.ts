// Pure, dependency-free logic split out of src/lib/endRoom.ts.
//
// endRoom.ts is marked `import "server-only"` because most of what it does
// (Supabase admin calls, endLiveKitRoom, publishSystemSignal) must never run
// in a browser bundle. But a `server-only` import poisons the ENTIRE module
// for any non-Next runtime too — including a plain `npx tsx` run, which is
// exactly how this repo's scripts/*.test.ts house style works (see
// scripts/end-room.test.ts). There is no bare `server-only` package in
// node_modules (Next aliases its own copy at build/webpack time only), so
// importing anything from endRoom.ts from a tsx-run test script fails hard
// with MODULE_NOT_FOUND before a single test can run.
//
// The fix is this split, not deleting the guard: the functions that belong
// here have no DB/network/SDK dependency at all — they are pure, and were
// always meant to be unit-testable per the brief. endRoom.ts re-exports
// everything below unchanged, so every existing server-side caller keeps
// importing from "@/lib/endRoom" exactly as before; only the test file reaches
// in here directly.
export interface SpaceRoomRow {
  id: string;
  livekit_room?: string | null;
}

// The canonical LiveKit room-name derivation. Every place that needs to talk
// to LiveKit about a given space (minting a join token, tearing the room
// down, applying stage permissions after a host promotion, etc.) MUST call
// this instead of inlining `space.livekit_room ?? \`space_${space.id}\``, so
// the derivation can never drift between routes.
export function deriveRoomName(space: SpaceRoomRow): string {
  return space.livekit_room ?? `space_${space.id}`;
}

// How long the host can go unseen before the room is considered abandoned and
// eligible for reaping. 120s: comfortably longer than one missed 60s room
// heartbeat (see page.tsx's `ping` interval) so a single dropped beat never
// triggers a false reap, but short enough that a genuinely abandoned room does
// not strand its remaining occupants for long. A stale beat alone is NOT
// enough to reap: decideHostReap() below also requires the host to be gone
// from LiveKit, which is what keeps a backgrounded mobile host's room alive.
export const HOST_GRACE_PERIOD_SECONDS = 120;

// Pure predicate, unit-testable without a DB: is a host whose last-seen
// timestamp is `hostLastSeenAt` (as of `now`) considered abandoned?
// `hostLastSeenAt === null` (never recorded — e.g. rooms created before the
// host_last_seen_at column existed, or before the host's first heartbeat
// lands) is treated as NOT abandoned; callers should backfill it on next
// touch rather than reaping a room purely for lacking history.
export function isHostAbandoned(
  hostLastSeenAt: string | null,
  now: Date = new Date(),
  graceSeconds: number = HOST_GRACE_PERIOD_SECONDS,
): boolean {
  if (!hostLastSeenAt) return false;
  const lastSeenMs = new Date(hostLastSeenAt).getTime();
  if (Number.isNaN(lastSeenMs)) return false;
  const elapsedSeconds = (now.getTime() - lastSeenMs) / 1000;
  // Exactly at the boundary is NOT yet abandoned — the room becomes eligible
  // the instant elapsed time exceeds the grace period, not when it equals it.
  return elapsedSeconds > graceSeconds;
}

// Is the host still connected to the room's LiveKit session right now?
//   "present" — LiveKit reports the host's identity in the room.
//   "absent"  — LiveKit answered and the host (or the whole room) is gone.
//   "unknown" — we could not ask (API error, timeout). Never grounds for a reap.
export type HostLiveKitPresence = "present" | "absent" | "unknown";

// What reapIfHostAbandoned should do with a live room:
//   "keep"    — host is within grace, or we can't tell; touch nothing.
//   "refresh" — the beat is stale but the host is still in LiveKit (a mobile
//               WebView suspends JS timers in the background while the audio
//               session keeps the connection up). Stamp host_last_seen_at.
//   "reap"    — stale beat AND confirmed gone from LiveKit. End the room.
export type HostReapDecision = "keep" | "refresh" | "reap";

// Pure predicate behind the lazy host-abandonment reaper. The heartbeat alone
// is not proof of absence: Android/iOS throttle or freeze setInterval once the
// app is backgrounded, so a host who is still live (and still heard) stops
// beating after a minute or two. The LiveKit connection is the ground truth.
export function decideHostReap(
  hostLastSeenAt: string | null,
  presence: HostLiveKitPresence,
  now: Date = new Date(),
  graceSeconds: number = HOST_GRACE_PERIOD_SECONDS,
): HostReapDecision {
  if (!isHostAbandoned(hostLastSeenAt, now, graceSeconds)) return "keep";
  if (presence === "present") return "refresh";
  if (presence === "absent") return "reap";
  return "keep"; // fail safe: a LiveKit outage must never end live rooms
}
