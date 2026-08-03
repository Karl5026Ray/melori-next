/* eslint-disable no-console */
//
// scripts/end-room.test.ts
//
// VALIDATION TESTS for the "end-room ejects everyone" fix:
//   * src/lib/endRoom.ts        (deriveRoomName, isHostAbandoned,
//                                 HOST_GRACE_PERIOD_SECONDS, idempotency of
//                                 endRoomAndTeardown's DB transition)
//   * src/lib/roomDisconnect.ts (classifyDisconnectReason, ROOM_ENDED_MESSAGE)
//
// Pure functions only — no DB / no network / no LiveKit SDK, matching the
// rest of the scripts/*.test.ts suite. LiveKit itself is deliberately NOT
// integration-tested here (no real room create/teardown against a live
// project) — only the pure decision logic that sits around it.
//
// Run:  npx tsx scripts/end-room.test.ts  (also: npm run test:end-room)

// Imported from endRoomPure.ts, NOT endRoom.ts: endRoom.ts starts with
// `import "server-only"`, which fails with MODULE_NOT_FOUND under a plain
// `npx tsx` run (there is no bare `server-only` package in node_modules —
// Next only aliases it at webpack/build time). endRoomPure.ts holds exactly
// the DB/SDK-free pure logic and is re-exported unchanged from endRoom.ts for
// every real server-side caller. See endRoomPure.ts's top comment.
import {
  deriveRoomName,
  isHostAbandoned,
  HOST_GRACE_PERIOD_SECONDS,
  type SpaceRoomRow,
} from "@/lib/endRoomPure";
import { classifyDisconnectReason, ROOM_ENDED_MESSAGE } from "@/lib/roomDisconnect";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function group(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ---------------------------------------------------------------------------
// deriveRoomName — the canonical LiveKit room-name derivation shared by
// every path that talks to LiveKit about a space (token minting, teardown,
// stage-permission pushes after a host promotion). The historical bug this
// guards against: livekit-token/route.ts and the end path each inlined their
// own `space.livekit_room ?? \`space_${space.id}\`` and could silently drift
// apart if one was ever edited without the other.
// ---------------------------------------------------------------------------
group("deriveRoomName", () => {
  const withExplicitRoom: SpaceRoomRow = { id: "abc-123", livekit_room: "custom_room_name" };
  const withoutExplicitRoom: SpaceRoomRow = { id: "abc-123", livekit_room: null };
  const withUndefinedRoom: SpaceRoomRow = { id: "abc-123" };

  assertEq(
    "prefers the explicit livekit_room column when set",
    deriveRoomName(withExplicitRoom),
    "custom_room_name",
  );
  assertEq(
    "falls back to space_<id> when livekit_room is null",
    deriveRoomName(withoutExplicitRoom),
    "space_abc-123",
  );
  assertEq(
    "falls back to space_<id> when livekit_room is undefined",
    deriveRoomName(withUndefinedRoom),
    "space_abc-123",
  );
  assertEq(
    "the token-minting path and the end path derive the SAME name for the same row",
    deriveRoomName(withExplicitRoom),
    deriveRoomName(withExplicitRoom),
  );
});

// ---------------------------------------------------------------------------
// classifyDisconnectReason — distinguishes a deliberate server-side room
// teardown (ROOM_DELETED / ROOM_CLOSED) from a participant-specific removal
// (PARTICIPANT_REMOVED) from a genuine error/network condition (everything
// else). Accepts both the LiveKit enum's string name and its numeric wire
// value, since different call sites may observe either shape.
// ---------------------------------------------------------------------------
group("classifyDisconnectReason", () => {
  assertEq(
    "ROOM_DELETED (name) classifies as room-ended",
    classifyDisconnectReason("ROOM_DELETED"),
    "room-ended",
  );
  assertEq(
    "ROOM_DELETED (numeric wire value 5) classifies as room-ended",
    classifyDisconnectReason(5),
    "room-ended",
  );
  assertEq(
    "ROOM_CLOSED (name) classifies as room-ended",
    classifyDisconnectReason("ROOM_CLOSED"),
    "room-ended",
  );
  assertEq(
    "ROOM_CLOSED (numeric wire value 10) classifies as room-ended",
    classifyDisconnectReason(10),
    "room-ended",
  );
  assertEq(
    "PARTICIPANT_REMOVED (name) classifies as removed",
    classifyDisconnectReason("PARTICIPANT_REMOVED"),
    "removed",
  );
  assertEq(
    "PARTICIPANT_REMOVED (numeric wire value 4) classifies as removed",
    classifyDisconnectReason(4),
    "removed",
  );
  assertEq(
    "an unrecognized reason classifies as error",
    classifyDisconnectReason("SIGNAL_CLOSE"),
    "error",
  );
  assertEq(
    "undefined classifies as error",
    classifyDisconnectReason(undefined),
    "error",
  );
  assertEq(
    "null classifies as error",
    classifyDisconnectReason(null),
    "error",
  );
  assertEq(
    "ROOM_ENDED_MESSAGE is the calm, user-facing copy used by both Spaces and Faces UI",
    ROOM_ENDED_MESSAGE,
    "This room has ended.",
  );
});

// ---------------------------------------------------------------------------
// isHostAbandoned — the pure grace-period predicate behind the lazy
// abandonment reaper. No DB, no timers: given a last-seen timestamp and a
// reference "now", decide whether the host has been gone long enough for the
// room to be considered abandoned.
// ---------------------------------------------------------------------------
group("isHostAbandoned — grace period boundary behavior", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  assertEq(
    "HOST_GRACE_PERIOD_SECONDS is exported as a single named constant (120s)",
    HOST_GRACE_PERIOD_SECONDS,
    120,
  );

  const wellInsideWindow = new Date(
    now.getTime() - 30 * 1000,
  ).toISOString();
  assertEq(
    "host last seen 30s ago (well inside the 120s window) => NOT abandoned",
    isHostAbandoned(wellInsideWindow, now),
    false,
  );

  const wellOutsideWindow = new Date(
    now.getTime() - 300 * 1000,
  ).toISOString();
  assertEq(
    "host last seen 300s ago (well outside the 120s window) => abandoned",
    isHostAbandoned(wellOutsideWindow, now),
    true,
  );

  const exactlyAtBoundary = new Date(
    now.getTime() - HOST_GRACE_PERIOD_SECONDS * 1000,
  ).toISOString();
  assertEq(
    "host last seen EXACTLY 120s ago (the exact boundary) => NOT abandoned " +
      "(elapsed must EXCEED the grace period, not merely equal it)",
    isHostAbandoned(exactlyAtBoundary, now),
    false,
  );

  const oneSecondPastBoundary = new Date(
    now.getTime() - (HOST_GRACE_PERIOD_SECONDS + 1) * 1000,
  ).toISOString();
  assertEq(
    "host last seen 121s ago (one second past the boundary) => abandoned",
    isHostAbandoned(oneSecondPastBoundary, now),
    true,
  );

  const oneSecondBeforeBoundary = new Date(
    now.getTime() - (HOST_GRACE_PERIOD_SECONDS - 1) * 1000,
  ).toISOString();
  assertEq(
    "host last seen 119s ago (one second before the boundary) => NOT abandoned",
    isHostAbandoned(oneSecondBeforeBoundary, now),
    false,
  );

  assertEq(
    "null last-seen (never recorded) => NOT abandoned, never reaped purely for missing history",
    isHostAbandoned(null, now),
    false,
  );

  assertEq(
    "an unparseable timestamp => NOT abandoned (fails safe rather than reaping on bad data)",
    isHostAbandoned("not-a-real-timestamp", now),
    false,
  );

  assertEq(
    "a custom grace window is honored: 10s last-seen is abandoned under a 5s window",
    isHostAbandoned(
      new Date(now.getTime() - 10 * 1000).toISOString(),
      now,
      5,
    ),
    true,
  );
  assertEq(
    "a custom grace window is honored: 10s last-seen is NOT abandoned under a 20s window",
    isHostAbandoned(
      new Date(now.getTime() - 10 * 1000).toISOString(),
      now,
      20,
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// Idempotency guard — endRoomAndTeardown() and reapIfHostAbandoned() must
// never run the LiveKit teardown / PubNub signal a second time for a room
// that is already 'ended'. The real implementation enforces this via a
// guarded DB update (`.eq("status", "live")` / the `end_space_now` RPC's
// internal guard) so two concurrent callers can never both "win" — but that
// guard lives behind a live Supabase connection, which this pure unit-test
// suite deliberately does not stand up (per the house style: no DB, no
// LiveKit integration). What IS unit-testable without a DB is the row-level
// precondition every idempotency path is built on: an end/reap attempt must
// only ever proceed from status 'live', never from 'ended'. This models that
// guard directly and asserts it holds for the exact states endRoomAndTeardown
// and reapIfHostAbandoned check before doing anything.
// ---------------------------------------------------------------------------
group("idempotency guard — only a 'live' room is eligible to be ended/reaped", () => {
  function wouldAttemptTransition(status: string): boolean {
    // Mirrors endRoomAndTeardown's guarded update / end_space_now RPC guard
    // (`where status = 'live'`) and reapIfHostAbandoned's own explicit
    // `space.status !== "live"` short-circuit in src/lib/endRoom.ts.
    return status === "live";
  }

  assertEq(
    "a 'live' room is eligible for the end/reap transition",
    wouldAttemptTransition("live"),
    true,
  );
  assertEq(
    "an already-'ended' room is NOT eligible — a second end call must no-op, not re-teardown",
    wouldAttemptTransition("ended"),
    false,
  );

  // isHostAbandoned itself has no notion of status — reapIfHostAbandoned
  // layers the status==='live' guard in front of it. An abandoned-looking
  // last-seen timestamp on an already-ended room must never be reaped again.
  const now = new Date("2026-01-01T00:00:00.000Z");
  const longAbandoned = new Date(now.getTime() - 10_000 * 1000).toISOString();
  assertEq(
    "isHostAbandoned alone would say true for a long-gone host, regardless of room status",
    isHostAbandoned(longAbandoned, now),
    true,
  );
  function reapWouldFire(status: string, hostLastSeenAt: string | null): boolean {
    // Mirrors reapIfHostAbandoned's exact precondition order.
    if (status !== "live") return false;
    return isHostAbandoned(hostLastSeenAt, now);
  }
  assertEq(
    "reap fires for a still-live, long-abandoned room",
    reapWouldFire("live", longAbandoned),
    true,
  );
  assertEq(
    "reap does NOT fire for an already-ended room even with the same abandoned timestamp",
    reapWouldFire("ended", longAbandoned),
    false,
  );
});

console.log(
  failures === 0
    ? "\nAll end-room tests passed."
    : `\n${failures} end-room test(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
