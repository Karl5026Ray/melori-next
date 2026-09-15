/* eslint-disable no-console */
// Tests for MM Cinema talk mode and whispers.
//
// Talk mode decides who may be HEARD in a Cinema room. The invariants that
// matter, and why:
//
//  - Silent means silent, the HOST INCLUDED. If a host could still talk in
//    Silent it would be indistinguishable from Director's Commentary, and the
//    mode would be a lie told to the room.
//  - Talk mode gates the MICROPHONE ONLY. Someone holding a camera slot stays
//    on screen in every mode — Silent is a room where you can see each other
//    and not talk, not a room where the picture disappears.
//  - Enforcement is server-side, at BOTH the moment the mode changes and the
//    moment anyone joins. Without the join-time half, silencing a room would
//    last exactly until somebody hit reload and minted a fresh token.
//  - A room with no talk-state row — every room created before migration 078 —
//    must keep working, so an absent or unreadable mode coerces to the default
//    rather than failing closed and silencing rooms nobody silenced.
//  - Whispers ride the ordinary DM system, so the ROOM's own moderation
//    (bans) has to be enforced on the whisper path: the DM system knows about
//    global blocks and nothing about per-room bans.
//
// Run: npx tsx scripts/cinema-talk-mode.test.ts

import fs from "node:fs";
import path from "node:path";
import {
  canSpeakInTalkMode,
  toCinemaTalkMode,
  isCinemaTalkMode,
  DEFAULT_CINEMA_TALK_MODE,
  type CinemaTalkMode,
} from "@/lib/cinemaTalkModes";
import {
  decideRoomPublish,
  type CinemaReservation,
  type RoomMediaInput,
} from "@/lib/roomMediaPolicy";

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

let failures = 0;

function assertEq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(
      `  FAIL ${label}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function check(label: string, condition: boolean) {
  assertEq(label, Boolean(condition), true);
}

const HOST = "host-user";
const GUEST = "guest-user";

const hostSlot: CinemaReservation = { slot: 0, userId: HOST };
const guestSlot: CinemaReservation = { slot: 1, userId: GUEST };

function input(overrides: Partial<RoomMediaInput> = {}): RoomMediaInput {
  return {
    roomFormat: "cinema",
    hostId: HOST,
    userId: HOST,
    role: "host",
    hostMuted: false,
    reservations: [hostSlot, guestSlot],
    requested: ["camera", "microphone"],
    ...overrides,
  };
}

console.log("\ncanSpeakInTalkMode — Silent silences everyone, the host included");
assertEq("silent + host -> no mic", canSpeakInTalkMode("silent", "host"), false);
assertEq("silent + moderator -> no mic", canSpeakInTalkMode("silent", "moderator"), false);
assertEq("silent + speaker -> no mic", canSpeakInTalkMode("silent", "speaker"), false);
assertEq("silent + audience -> no mic", canSpeakInTalkMode("silent", "audience"), false);

console.log("\ncanSpeakInTalkMode — Commentary is the host alone");
assertEq("commentary + host -> mic", canSpeakInTalkMode("commentary", "host"), true);
assertEq("commentary + moderator -> no mic", canSpeakInTalkMode("commentary", "moderator"), false);
assertEq("commentary + speaker -> no mic", canSpeakInTalkMode("commentary", "speaker"), false);
assertEq("commentary + audience -> no mic", canSpeakInTalkMode("commentary", "audience"), false);

console.log("\ncanSpeakInTalkMode — Intermission opens the stage, not the room");
assertEq("intermission + host -> mic", canSpeakInTalkMode("intermission", "host"), true);
assertEq("intermission + moderator -> mic", canSpeakInTalkMode("intermission", "moderator"), true);
assertEq("intermission + speaker -> mic", canSpeakInTalkMode("intermission", "speaker"), true);
assertEq(
  "intermission + audience -> still no mic (a mode never promotes anyone)",
  canSpeakInTalkMode("intermission", "audience"),
  false,
);

console.log("\ncanSpeakInTalkMode — an unrecognized mode fails closed");
assertEq(
  "garbage mode + host -> no mic",
  canSpeakInTalkMode("karaoke" as CinemaTalkMode, "host"),
  false,
);

console.log("\ntoCinemaTalkMode — unreadable input becomes the default, never nothing");
assertEq("null -> default", toCinemaTalkMode(null), DEFAULT_CINEMA_TALK_MODE);
assertEq("undefined -> default", toCinemaTalkMode(undefined), DEFAULT_CINEMA_TALK_MODE);
assertEq("garbage -> default", toCinemaTalkMode("loud"), DEFAULT_CINEMA_TALK_MODE);
assertEq("a real mode passes through", toCinemaTalkMode("silent"), "silent");
assertEq("isCinemaTalkMode rejects garbage", isCinemaTalkMode("loud"), false);

console.log("\ndecideRoomPublish — talk mode gates the mic and never the camera");
assertEq(
  "Silent: the host keeps their camera slot and loses the mic",
  decideRoomPublish(input({ talkMode: "silent" })).allowedSources,
  ["camera"],
);
assertEq(
  "Silent: a guest in a live box keeps their camera and loses the mic",
  decideRoomPublish(input({ userId: GUEST, role: "speaker", talkMode: "silent" }))
    .allowedSources,
  ["camera"],
);
assertEq(
  "Silent: the host's camera SLOT survives — the picture is untouched",
  decideRoomPublish(input({ talkMode: "silent" })).cameraSlot,
  0,
);
assertEq(
  "Commentary: the host keeps camera and mic",
  decideRoomPublish(input({ talkMode: "commentary" })).allowedSources,
  ["camera", "microphone"],
);
assertEq(
  "Commentary: a guest speaker keeps their camera but is muted",
  decideRoomPublish(input({ userId: GUEST, role: "speaker", talkMode: "commentary" }))
    .allowedSources,
  ["camera"],
);
assertEq(
  "Intermission: a guest speaker keeps camera and mic",
  decideRoomPublish(input({ userId: GUEST, role: "speaker", talkMode: "intermission" }))
    .allowedSources,
  ["camera", "microphone"],
);

console.log("\ndecideRoomPublish — a silenced mic-only participant is reported as such");
assertEq(
  "audio-only guest under Silent reports talk-mode-silenced",
  decideRoomPublish(
    input({
      userId: GUEST,
      role: "speaker",
      reservations: [hostSlot],
      requested: ["microphone"],
      talkMode: "silent",
    }),
  ).reason,
  "talk-mode-silenced",
);

console.log("\ndecideRoomPublish — rooms that predate migration 078 are unaffected");
assertEq(
  "no talkMode supplied behaves exactly like the default mode",
  decideRoomPublish(input({ userId: GUEST, role: "speaker" })).allowedSources,
  decideRoomPublish(
    input({ userId: GUEST, role: "speaker", talkMode: DEFAULT_CINEMA_TALK_MODE }),
  ).allowedSources,
);
assertEq(
  "an unreadable talkMode also behaves like the default",
  decideRoomPublish(input({ userId: GUEST, role: "speaker", talkMode: "nonsense" }))
    .allowedSources,
  decideRoomPublish(
    input({ userId: GUEST, role: "speaker", talkMode: DEFAULT_CINEMA_TALK_MODE }),
  ).allowedSources,
);

console.log("\ndecideRoomPublish — talk mode never overrides a stronger restriction");
assertEq(
  "an audience member gets nothing even in Intermission",
  decideRoomPublish(input({ userId: GUEST, role: "audience", talkMode: "intermission" }))
    .allowedSources,
  [],
);
assertEq(
  "a host-muted speaker stays muted in Intermission",
  decideRoomPublish(
    input({ userId: GUEST, role: "speaker", hostMuted: true, talkMode: "intermission" }),
  ).allowedSources,
  [],
);
assertEq(
  "talk mode does not leak into non-Cinema rooms",
  decideRoomPublish(
    input({ roomFormat: "live_group", role: "speaker", userId: GUEST, talkMode: "silent" }),
  ).allowedSources.includes("microphone"),
  true,
);

// --- Source-text invariants ------------------------------------------------
// The repo's established way of pinning server-side security properties that
// cannot easily be executed here (see cinema-server-invariants.test.ts).

const migration = read("supabase/migrations/078_cinema_talk_mode.sql");
const slotsRealtime = read("supabase/migrations/079_cinema_camera_slots_realtime.sql");
const talkRoute = read("src/app/api/social/spaces/[spaceId]/talk-mode/route.ts");
const whisperRoute = read("src/app/api/social/spaces/[spaceId]/whisper/route.ts");
const tokenRoute = read("src/app/api/livekit-token/route.ts");
const modes = read("src/lib/cinemaTalkModes.ts");

console.log("\nmigration 078 — durable truth, readable by the room, writable by nobody");
check(
  "the mode is constrained in the database, not only in TypeScript",
  /check \(talk_mode in \('silent', 'intermission', 'commentary'\)\)/.test(migration),
);
check("RLS is on", /alter table public\.room_talk_state enable row level security/.test(migration));
check("there is a read policy", /create policy "room_talk_state_read"/.test(migration));
check(
  "there is NO client write policy — the route is the only write path",
  !/for (insert|update|delete)/i.test(migration),
);
check(
  "the table is added to the realtime publication",
  /alter publication supabase_realtime add table public\.room_talk_state/.test(migration),
);
check(
  "replica identity is FULL so the payload carries the row",
  /alter table public\.room_talk_state replica identity full/.test(migration),
);
check(
  "the column default matches DEFAULT_CINEMA_TALK_MODE",
  migration.includes(`default '${DEFAULT_CINEMA_TALK_MODE}'`) &&
    modes.includes(`DEFAULT_CINEMA_TALK_MODE: CinemaTalkMode = "${DEFAULT_CINEMA_TALK_MODE}"`),
);

console.log("\nmigration 079 — the camera-slot realtime fix");
check(
  "cinema_camera_slots joins the realtime publication",
  /alter publication supabase_realtime add table public\.cinema_camera_slots/.test(slotsRealtime),
);
check(
  "cinema_camera_slots gets replica identity full",
  /alter table public\.cinema_camera_slots replica identity full/.test(slotsRealtime),
);

console.log("\n/talk-mode route — host or moderator only, and it actually mutes people");
check(
  "authority is read from the database, not the request body",
  talkRoute.includes('.from("spaces")') && talkRoute.includes("space.host_id === callerId"),
);
check(
  "a non-host non-moderator is refused",
  talkRoute.includes("Only the host or a moderator can change the talk mode") &&
    talkRoute.includes("status: 403"),
);
check(
  "a moderator who has left the room no longer counts",
  talkRoute.includes("left_at"),
);
check("the mode is validated before it is stored", talkRoute.includes("isCinemaTalkMode(body.talk_mode)"));
check(
  "permission is reapplied across the whole roster, not just the caller",
  talkRoute.includes("applyStagePermissions") && talkRoute.includes("space_participants"),
);
check(
  "an already-open microphone is explicitly silenced, not merely de-permissioned",
  talkRoute.includes('revokePublishedSources') && talkRoute.includes('"microphone"'),
);

console.log("\nlivekit-token route — the mode survives a reload");
check(
  "the token route reads the room's talk mode",
  tokenRoute.includes('.from("room_talk_state")'),
);
check(
  "and threads it into the publish decision",
  /decideRoomPublish\(\{[\s\S]*?talkMode,[\s\S]*?\}\)/.test(tokenRoute),
);
check(
  "an unreadable talk mode fails the join rather than granting a mic",
  tokenRoute.includes("Cinema audio authorization is unavailable"),
);

console.log("\n/whisper route — room moderation is enforced where the DM system cannot");
check(
  "only a host or moderator may open a whisper",
  whisperRoute.includes("Only the host or a moderator can start a whisper"),
);
check(
  "the other person must actually be in the room",
  whisperRoute.includes("That person is not in this room"),
);
check(
  "per-room bans are honoured — the DM system never checks them",
  whisperRoute.includes('.from("space_bans")'),
);
check(
  "global blocks are honoured too",
  whisperRoute.includes('.from("member_blocks")'),
);
check(
  "a room whisper does not open as a message request",
  whisperRoute.includes('status: "accepted"'),
);
check(
  "the route never writes a message itself — sending stays on the guarded path",
  !whisperRoute.includes('.from("messages")\n    .insert'),
);

console.log(
  failures === 0
    ? "\nAll Cinema talk-mode assertions passed.\n"
    : `\n${failures} Cinema talk-mode assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
