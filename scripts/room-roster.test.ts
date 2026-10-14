/* eslint-disable no-console */
// scripts/room-roster.test.ts
//
// Pins the live-room roster scaling fix (14 Oct 2026):
//   • realtime changes are applied to the roster incrementally (applyRosterChange)
//     instead of every client refetching the whole roster on every change;
//   • the audience is capped (AUDIENCE_CAP) with an accurate hidden count, and
//     the stage and the viewer's own row are always held;
//   • the resync safety net is jittered so clients don't stampede;
//   • wiring: Spaces, Cinema and Faces all read the roster through useRoomRoster,
//     none of them refetch per change or poll the full roster, and livekitClient
//     no longer writes speaking state to the database.
//
// Run:  npx tsx scripts/room-roster.test.ts

import { readFileSync } from "node:fs";
import {
  AUDIENCE_CAP,
  ROSTER_RESYNC_MS,
  applyRosterChange,
  applyRosterChanges,
  emptyRoster,
  missingProfileIds,
  nextResyncDelay,
  rosterFromSnapshot,
  type RosterRow,
  type RosterState,
} from "@/lib/rooms/rosterState";

let checks = 0;
let failures = 0;
const expect = (cond: boolean, label: string) => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
  }
};
const read = (path: string) => readFileSync(path, "utf8");

interface Row extends RosterRow {
  is_muted?: boolean;
  user?: { id: string; display_name: string } | undefined;
}

const t = (n: number) => new Date(Date.UTC(2026, 9, 14, 12, 0, n)).toISOString();
const row = (n: number, extra: Partial<Row> = {}): Row => ({
  id: `row-${n}`,
  user_id: `user-${n}`,
  role: "audience",
  left_at: null,
  joined_at: t(n),
  has_raised_hand: false,
  is_muted: true,
  user: { id: `user-${n}`, display_name: `User ${n}` },
  ...extra,
});
const ids = (s: RosterState<Row>) => s.rows.map((r) => r.id).join(",");

console.log("\napplyRosterChange — incremental updates");
{
  const start: RosterState<Row> = { rows: [row(1, { role: "host" }), row(2)], hiddenAudience: 0 };

  const ins = applyRosterChange(start, { eventType: "INSERT", new: { ...row(3), user: undefined } });
  expect(ids(ins) === "row-1,row-2,row-3", "INSERT adds the new row");
  expect(ins.rows[2].user === undefined, "INSERT row has no profile until it is looked up");

  const upd = applyRosterChange(start, {
    eventType: "UPDATE",
    new: { ...row(2), user: undefined, has_raised_hand: true, is_muted: false },
  });
  expect(upd.rows[1].has_raised_hand === true && upd.rows[1].is_muted === false, "UPDATE merges fields");
  expect(upd.rows[1].user?.display_name === "User 2", "UPDATE keeps the joined profile the payload lacks");
  expect(start.rows[1].has_raised_hand === false, "reducer does not mutate its input");

  const left = applyRosterChange(start, {
    eventType: "UPDATE",
    new: { ...row(2), user: undefined, left_at: t(99) },
  });
  expect(ids(left) === "row-1", "UPDATE setting left_at removes the row");

  const del = applyRosterChange(start, { eventType: "DELETE", old: { id: "row-2" } });
  expect(ids(del) === "row-1", "DELETE removes by id (default replica identity: old = {id})");

  const noop = applyRosterChange(start, { eventType: "DELETE", old: { id: "row-404" } });
  expect(noop === start, "DELETE of an unknown row is a no-op");

  const rejoinOrder = applyRosterChange(
    { rows: [row(5), row(6)], hiddenAudience: 0 },
    { eventType: "INSERT", new: row(4) },
  );
  expect(ids(rejoinOrder) === "row-4,row-5,row-6", "rows stay in join order");

  const batched = applyRosterChanges(start, [
    { eventType: "INSERT", new: row(3) },
    { eventType: "UPDATE", new: { ...row(3), has_raised_hand: true } },
    { eventType: "UPDATE", new: { ...row(1), left_at: t(50) } },
  ]);
  expect(ids(batched) === "row-2,row-3" && batched.rows[1].has_raised_hand === true, "a coalesced burst applies in order");

  const replay = applyRosterChanges(upd, [
    { eventType: "UPDATE", new: { ...row(2), has_raised_hand: true, is_muted: false } },
  ]);
  expect(ids(replay) === ids(upd) && replay.rows[1].has_raised_hand === true, "replaying a change the snapshot already has is harmless");
}

console.log("\naudience cap + hidden count");
{
  const cap = 2;
  const full: RosterState<Row> = { rows: [row(1, { role: "host" }), row(2), row(3)], hiddenAudience: 5 };

  const overflow = applyRosterChange(full, { eventType: "INSERT", new: row(10) }, { audienceCap: cap });
  expect(ids(overflow) === ids(full) && overflow.hiddenAudience === 6, "INSERT past the cap counts instead of holding");

  const stageJoin = applyRosterChange(full, { eventType: "INSERT", new: row(11, { role: "speaker" }) }, { audienceCap: cap });
  expect(stageJoin.rows.some((r) => r.id === "row-11"), "stage rows are always held");

  const me = applyRosterChange(full, { eventType: "INSERT", new: row(12) }, { audienceCap: cap, selfId: "user-12" });
  expect(me.rows.some((r) => r.id === "row-12"), "the viewer's own row is always held");

  const handUp = applyRosterChange(full, { eventType: "UPDATE", new: row(13, { has_raised_hand: true }) }, { audienceCap: cap });
  expect(handUp.rows.some((r) => r.id === "row-13") && handUp.hiddenAudience === 4, "a hidden listener raising a hand surfaces and leaves the count");

  const mute = applyRosterChange(full, { eventType: "UPDATE", new: row(14, { is_muted: false }) }, { audienceCap: cap });
  expect(mute === full, "a hidden listener's minor update is ignored");

  const hiddenLeft = applyRosterChange(full, { eventType: "UPDATE", new: row(15, { left_at: t(90) }) }, { audienceCap: cap });
  expect(hiddenLeft.hiddenAudience === 4, "a hidden listener leaving decrements the count");

  const empty = applyRosterChange({ ...full, hiddenAudience: 0 }, { eventType: "UPDATE", new: row(16, { left_at: t(90) }) }, { audienceCap: cap });
  expect(empty.hiddenAudience === 0, "the hidden count never goes negative");

  expect(AUDIENCE_CAP === 200, "audience cap matches the Cinema spec (200)");
}

console.log("\nrosterFromSnapshot");
{
  const stage = [row(1, { role: "host" })];
  const audience = [row(3, { has_raised_hand: true }), row(2)];
  const self = [row(2)];
  const snap = rosterFromSnapshot<Row>([stage, audience, self], 250);
  expect(ids(snap) === "row-1,row-2,row-3", "lists merge by id, de-duplicated, in join order");
  expect(snap.hiddenAudience === 248, "hidden = exact audience count minus audience held");
  const noCount = rosterFromSnapshot<Row>([stage, audience], null);
  expect(noCount.hiddenAudience === 0, "no count -> nothing hidden");
  const mockedSame = rosterFromSnapshot<Row>([[...stage, ...audience], [...stage, ...audience], null], null);
  expect(mockedSame.rows.length === 3, "identical lists (e2e mocks) collapse to one roster");
  const withLeft = rosterFromSnapshot<Row>([[row(1), row(2, { left_at: t(9) })]], 1);
  expect(ids(withLeft) === "row-1", "left rows are dropped");
  expect(emptyRoster<Row>().rows.length === 0, "emptyRoster is empty");
}

console.log("\nprofiles + resync jitter");
{
  const rows: Row[] = [row(1), { ...row(2), user: undefined }, { ...row(3), user: undefined }, { ...row(4), user: undefined }];
  const missing = missingProfileIds(rows, (id) => id === "user-3");
  expect(missing.join(",") === "user-2,user-4", "only unknown user ids need a profile fetch");
  const lo = nextResyncDelay(ROSTER_RESYNC_MS, 0.25, () => 0);
  const hi = nextResyncDelay(ROSTER_RESYNC_MS, 0.25, () => 0.999999);
  expect(lo === 45_000 && hi >= 74_999 && hi <= 75_000, "resync is 60s ± 25% jitter");
}

console.log("\nwiring");
{
  const hook = read("src/lib/rooms/useRoomRoster.ts");
  expect(hook.includes("applyRosterChanges(") && hook.includes('"postgres_changes"'), "hook applies realtime payloads through the reducer");
  expect(hook.includes(".limit(audienceCap)") && hook.includes('count: "exact"'), "hook caps the audience query and counts it exactly");
  expect(hook.includes("nextResyncDelay()") && hook.includes("visibilitychange"), "hook resyncs on a jittered timer and on tab return");
  expect(/setTimeout\(flush, ROSTER_COALESCE_MS\)/.test(hook), "hook coalesces realtime bursts");

  for (const [name, path] of [
    ["Spaces", "src/components/social/spaces/SpacesRoomScreen.tsx"],
    ["Cinema", "src/components/social/cinema/CinemaRoomScreen.tsx"],
    ["Faces", "src/components/social/faces/LiveRoom.tsx"],
  ] as const) {
    const src = read(path);
    expect(src.includes('from "@/lib/rooms/useRoomRoster"') && src.includes("useRoomRoster({"), `${name} reads the roster through useRoomRoster`);
    expect(!src.includes("fetchParticipants"), `${name} has no full-roster refetch`);
    expect(!/\/participants`,\s*\{\s*cache: "no-store"/.test(src), `${name} does not poll the participants route`);
  }
  expect(
    read("src/components/social/spaces/SpacesRoomScreen.tsx").includes("listeners.length + hiddenAudienceCount") &&
      read("src/components/social/cinema/CinemaRoomScreen.tsx").includes("cinemaAudience.length + hiddenAudienceCount"),
    "headcounts include listeners beyond the cap",
  );

  const lk = read("src/lib/livekitClient.ts");
  const lkCode = lk.replace(/\/\/.*$/gm, "");
  expect(!lkCode.includes("is_speaking"), "livekitClient no longer writes is_speaking");
  expect(!lkCode.includes("space_participants") && !lkCode.includes("@/lib/supabase"), "livekitClient does not touch the database");
  expect(lkCode.includes("onActiveSpeakersChange"), "speaking still comes from LiveKit ActiveSpeakersChanged");
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
