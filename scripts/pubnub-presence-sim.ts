/* eslint-disable no-console */
//
// scripts/pubnub-presence-sim.ts
//
// LOCAL TEST HARNESS for the PubNub ephemeral-presence layer.
//
// It runs WITHOUT any live PubNub / Supabase / Agora credentials by mocking:
//   * an in-memory "spaces" table (status live/ended)
//   * an in-memory "space_participants" table
//   * PubNub occupancy (hereNow)
//
// ...and then drives the SAME decision logic the real webhook uses
// (end-room-iff-occupancy-zero, idempotent, race-safe) against a sequence of
// presence events: join, join, leave, leave (last one empties the room), plus
// a crashed-tab `timeout` case and a duplicate-delivery case.
//
// Run:  npx tsx scripts/pubnub-presence-sim.ts
//
// This mirrors src/app/api/pubnub/presence-webhook/route.ts. Keep the two in
// sync if you change the end-room rule. The point is to let you verify the
// "rooms truly vanish once the last participant leaves" guarantee on your
// laptop, deterministically, before wiring real keys.

type Status = "scheduled" | "live" | "ended";

interface FakeSpace {
  id: string;
  status: Status;
  ended_at: string | null;
}

// ---- In-memory mock of the backend state --------------------------------
const spaces = new Map<string, FakeSpace>();
const occupancy = new Map<string, Set<string>>(); // spaceId -> set of uuids
const participantsLeftAt = new Map<string, Map<string, string | null>>();

function seedRoom(id: string) {
  spaces.set(id, { id, status: "live", ended_at: null });
  occupancy.set(id, new Set());
  participantsLeftAt.set(id, new Map());
}

// Mock: PubNub hereNow()
function hereNow(spaceId: string): number {
  return occupancy.get(spaceId)?.size ?? 0;
}

// Mock: the end_space_now() RPC — atomic, guarded, idempotent.
function endSpaceNow(spaceId: string): string | null {
  const s = spaces.get(spaceId);
  if (!s || s.status !== "live") return null; // idempotent no-op
  s.status = "ended";
  s.ended_at = new Date().toISOString();
  // mark lingering participants left
  const parts = participantsLeftAt.get(spaceId);
  if (parts) {
    for (const [uid, left] of parts) if (left === null) parts.set(uid, s.ended_at);
  }
  return spaceId;
}

// ---- The decision logic under test (mirror of the webhook) --------------
function endSpaceIfEmpty(spaceId: string, reportedOccupancy: number) {
  const s = spaces.get(spaceId);
  if (!s) return { ended: false, occupancy: 0, reason: "not-found" };
  if (s.status !== "live")
    return { ended: false, occupancy: 0, reason: `status-${s.status}` };

  // Race protection: trust hereNow() over the event's reported occupancy.
  let occ = reportedOccupancy;
  try {
    occ = hereNow(spaceId);
  } catch {
    /* keep reported */
  }
  if (occ > 0) return { ended: false, occupancy: occ, reason: "still-occupied" };

  const endedId = endSpaceNow(spaceId);
  return { ended: Boolean(endedId), occupancy: 0, reason: "ended-empty" };
}

interface EventResult {
  ok: boolean;
  action: string;
  checked: boolean;
  ended?: boolean;
  occupancy?: number;
  reason?: string;
}

function handlePresenceEvent(evt: {
  spaceId: string;
  action: "join" | "leave" | "timeout" | "interval";
  uuid?: string;
}): EventResult {
  const set = occupancy.get(evt.spaceId)!;
  if (evt.action === "join" && evt.uuid) {
    set.add(evt.uuid);
    participantsLeftAt.get(evt.spaceId)!.set(evt.uuid, null);
  } else if ((evt.action === "leave" || evt.action === "timeout") && evt.uuid) {
    set.delete(evt.uuid);
    participantsLeftAt.get(evt.spaceId)!.set(evt.uuid, new Date().toISOString());
  }

  const mayEmpty =
    evt.action === "leave" ||
    evt.action === "timeout" ||
    evt.action === "interval";
  if (!mayEmpty) return { ok: true, action: evt.action, checked: false };

  return {
    ok: true,
    action: evt.action,
    checked: true,
    ...endSpaceIfEmpty(evt.spaceId, set.size),
  };
}

// ---- Assertions ---------------------------------------------------------
let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}`);
  }
}

console.log("\nPubNub ephemeral-presence simulation\n" + "=".repeat(40));

// --- Scenario 1: normal drain (last leaver ends the room) ---
console.log("\n[1] Two members join, both leave \u2014 room must vanish");
seedRoom("room-1");
handlePresenceEvent({ spaceId: "room-1", action: "join", uuid: "alice" });
handlePresenceEvent({ spaceId: "room-1", action: "join", uuid: "bob" });
assert("room still live with 2 present", spaces.get("room-1")!.status === "live");
let r = handlePresenceEvent({ spaceId: "room-1", action: "leave", uuid: "alice" });
assert("room stays live after 1 of 2 leaves", spaces.get("room-1")!.status === "live");
assert("not ended (still occupied)", r.reason === "still-occupied");
r = handlePresenceEvent({ spaceId: "room-1", action: "leave", uuid: "bob" });
assert("room ENDED when last member left", spaces.get("room-1")!.status === "ended");
assert("reason is ended-empty", r.reason === "ended-empty");
assert("all participants marked left", [...participantsLeftAt.get("room-1")!.values()].every((v) => v !== null));

// --- Scenario 2: crashed tab (timeout, no explicit leave) ---
console.log("\n[2] Solo host crashes \u2014 timeout event must vanish the room");
seedRoom("room-2");
handlePresenceEvent({ spaceId: "room-2", action: "join", uuid: "carol" });
r = handlePresenceEvent({ spaceId: "room-2", action: "timeout", uuid: "carol" });
assert("room ENDED on timeout", spaces.get("room-2")!.status === "ended");

// --- Scenario 3: idempotency (duplicate leave delivery) ---
console.log("\n[3] Duplicate webhook delivery must be a safe no-op");
r = handlePresenceEvent({ spaceId: "room-2", action: "leave", uuid: "carol" });
assert("second delivery does not error", r.ok === true);
assert("stays ended (idempotent)", r.reason === "status-ended");

// --- Scenario 4: race \u2014 leave then immediate join before webhook processes ---
console.log("\n[4] Late joiner beats the leave webhook \u2014 room must survive");
seedRoom("room-4");
handlePresenceEvent({ spaceId: "room-4", action: "join", uuid: "dave" });
// dave leaves, but eve joins before the webhook's hereNow() runs:
occupancy.get("room-4")!.delete("dave");
occupancy.get("room-4")!.add("eve"); // eve already present at check time
const r4 = endSpaceIfEmpty("room-4", 0 /* stale reported occupancy */);
assert("room NOT ended (hereNow saw eve)", spaces.get("room-4")!.status === "live");
assert("reason still-occupied via hereNow race-protection", r4.reason === "still-occupied");

// --- Scenario 5: non-emptying events never end a room ---
console.log("\n[5] A join event must never end a room");
seedRoom("room-5");
r = handlePresenceEvent({ spaceId: "room-5", action: "join", uuid: "frank" });
assert("join is not a check", r.checked === false);
assert("room still live", spaces.get("room-5")!.status === "live");

console.log("\n" + "=".repeat(40));
console.log(`RESULT: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
