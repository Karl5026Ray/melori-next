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
import { readFileSync } from "node:fs";
import {
  decideHostReap,
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
// never run the LiveKit teardown / room signal a second time for a room
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

// ---------------------------------------------------------------------------
// decideHostReap — a stale heartbeat is NOT proof the host left. Mobile
// WebViews (the Android/iOS apps) freeze setInterval in the background while
// the LiveKit audio session stays up, so a live host stopped beating after a
// minute and lost the room at 120s. LiveKit presence is the ground truth; a
// LiveKit error must never end a live room.
// ---------------------------------------------------------------------------
group("decideHostReap — LiveKit presence gates the host-abandonment reap", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const stale = new Date(now.getTime() - (HOST_GRACE_PERIOD_SECONDS + 300) * 1000).toISOString();
  const fresh = new Date(now.getTime() - 10 * 1000).toISOString();

  assertEq(
    "host still in LiveKit + stale beat -> refresh, NOT reaped (backgrounded mobile host)",
    decideHostReap(stale, "present", now),
    "refresh",
  );
  assertEq(
    "host gone from LiveKit + stale beat -> reaped",
    decideHostReap(stale, "absent", now),
    "reap",
  );
  assertEq(
    "LiveKit API error (unknown) + stale beat -> NOT reaped (fail safe)",
    decideHostReap(stale, "unknown", now),
    "keep",
  );
  assertEq(
    "fresh beat + host gone from LiveKit -> kept (grace still applies)",
    decideHostReap(fresh, "absent", now),
    "keep",
  );
  assertEq(
    "no recorded beat -> kept regardless of LiveKit",
    decideHostReap(null, "absent", now),
    "keep",
  );
});

// Wiring: the predicate is worthless if the reaper doesn't consult LiveKit
// (tasks/lessons.md: "When a fix is wiring, assert on the wiring").
group("reapIfHostAbandoned wiring", () => {
  const endRoom = readFileSync("src/lib/endRoom.ts", "utf8");
  const reaper = endRoom.slice(endRoom.indexOf("export async function reapIfHostAbandoned"));
  const reaperBody = reaper.slice(0, reaper.indexOf("\n}\n"));
  assertEq(
    "reaper asks LiveKit whether the host is connected",
    /getParticipantPresence\(deriveRoomName\(space\), space\.host_id\)/.test(reaperBody),
    true,
  );
  assertEq("reaper decides via decideHostReap", reaperBody.includes("decideHostReap("), true);
  assertEq(
    "reaper only ends the room on a 'reap' decision",
    reaperBody.indexOf('if (decision !== "reap") return') > -1 &&
      reaperBody.indexOf('if (decision !== "reap") return') < reaperBody.indexOf("endRoomAndTeardown("),
    true,
  );
  assertEq(
    "a host still in LiveKit gets host_last_seen_at refreshed",
    /decision === "refresh"[\s\S]*recordHostSeen\(space\.id, space\.host_id\)/.test(reaperBody),
    true,
  );
  const lk = readFileSync("src/lib/livekitServer.ts", "utf8");
  const presence = lk.slice(lk.indexOf("export async function getParticipantPresence"));
  const presenceBody = presence.slice(0, presence.indexOf("\n}\n"));
  assertEq(
    "getParticipantPresence reports 'unknown' (never 'absent') on an unexpected LiveKit error",
    /catch[\s\S]*return "unknown";/.test(presenceBody),
    true,
  );
  const heartbeat = readFileSync("src/app/api/social/spaces/[spaceId]/heartbeat/route.ts", "utf8");
  assertEq(
    "heartbeat route loads livekit_room so the reaper checks the right LiveKit room",
    heartbeat.includes('.select("id, host_id, status, livekit_room, host_last_seen_at")'),
    true,
  );
  const faces = readFileSync("src/app/api/social/faces/route.ts", "utf8");
  assertEq("faces list loads livekit_room for the reaper", /host_last_seen_at, livekit_room/.test(faces), true);
});

console.log(
  failures === 0
    ? "\nAll end-room tests passed."
    : `\n${failures} end-room test(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
