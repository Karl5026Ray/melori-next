/* eslint-disable no-console */
// MM Auditions: entry rules, codes, files, recordings, and the wiring that
// keeps audition rooms private (token gate, listings, Mirror recording flow).
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  canReadFile,
  canStartRecording,
  canUploadKind,
  decideEntry,
  generateInviteCode,
  INVITE_CODE_ALPHABET,
  isAuditionFormat,
  MAX_RECORDINGS_PER_SESSION,
  normalizeInviteCode,
  normalizeReelUrl,
  resolveIsPrivate,
  undownloadedTakes,
  validateUpload,
} from "@/lib/auditions";
import { roomCreateHref, roomExitHref, roomHref } from "@/lib/cinema";
import { decideRoomPublish } from "@/lib/roomMediaPolicy";

let failures = 0;
function expect(name: string, actual: unknown, wanted: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(wanted)) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}\n         expected ${JSON.stringify(wanted)}\n         actual   ${JSON.stringify(actual)}`);
}
const read = (p: string) => readFileSync(p, "utf8");

console.log("Formats");
expect("table_read is an audition format", isAuditionFormat("table_read"), true);
expect("cinema is not", isAuditionFormat("cinema"), false);
expect("null is not", isAuditionFormat(null), false);
expect("callbacks are always private", resolveIsPrivate("callback", false), true);
expect("open audition stays open", resolveIsPrivate("audition", false), false);

console.log("Entry");
const open = { isPrivate: false, existing: null } as const;
expect("open table read: straight in", decideEntry({ format: "table_read", via: "open-listing", ...open }), { ok: true, status: "admitted" });
expect("open audition: lobby", decideEntry({ format: "audition", via: "open-listing", ...open }), { ok: true, status: "lobby" });
expect("private room without code: refused", decideEntry({ format: "audition", isPrivate: true, via: "open-listing", existing: null }), { ok: false, reason: "private" });
expect("private room with code: lobby", decideEntry({ format: "audition", isPrivate: true, via: "code", existing: null }), { ok: true, status: "lobby" });
expect("callback, code only: refused", decideEntry({ format: "callback", isPrivate: true, via: "code", existing: null }), { ok: false, reason: "invite-only" });
expect("callback, invited: lobby", decideEntry({ format: "callback", isPrivate: true, via: "code", existing: "invited" }), { ok: true, status: "lobby" });
expect("denied stays denied even with a code", decideEntry({ format: "table_read", isPrivate: true, via: "code", existing: "denied" }), { ok: false, reason: "denied" });
expect("admitted keeps the seat on rejoin", decideEntry({ format: "audition", isPrivate: true, via: "code", existing: "admitted" }), { ok: true, status: "admitted" });

console.log("Invite codes");
const code = generateInviteCode((n) => randomBytes(n));
expect("8 characters", code.length, 8);
expect("no look-alike characters", [...code].every((c) => INVITE_CODE_ALPHABET.includes(c)), true);
expect("typed with spaces and lower case", normalizeInviteCode(" abcd-2345 "), "ABCD2345");
expect("junk refused", normalizeInviteCode("x"), null);

console.log("Files");
expect("actors can't upload scripts", canUploadKind("script", false), false);
expect("directors can", canUploadKind("script", true), true);
expect("PDF script ok", validateUpload({ kind: "script", mime: "application/pdf", size: 1000 }).ok, true);
expect("image as script refused", validateUpload({ kind: "script", mime: "image/png", size: 1000 }).ok, false);
expect("16 MB refused", validateUpload({ kind: "resume", mime: "application/pdf", size: 16 * 1024 * 1024 }).ok, false);
expect("reel upload refused (links only)", validateUpload({ kind: "reel", mime: "video/mp4", size: 10 }).ok, false);
expect("https reel link ok", normalizeReelUrl("https://youtu.be/abc"), "https://youtu.be/abc");
expect("http reel link refused", normalizeReelUrl("http://youtu.be/abc"), null);
expect("javascript: refused", normalizeReelUrl("javascript:alert(1)"), null);
const f = { ownerId: "a", userId: "b", isDirector: false };
expect("admitted reader sees the script", canReadFile({ kind: "script", isAdmitted: true, ...f }), true);
expect("lobby actor can't see the script", canReadFile({ kind: "script", isAdmitted: false, ...f }), false);
expect("other actors' headshots are private", canReadFile({ kind: "headshot", isAdmitted: true, ...f }), false);
expect("director sees headshots", canReadFile({ kind: "headshot", isAdmitted: true, ownerId: "a", userId: "b", isDirector: true }), true);

console.log("Recordings");
expect("cap is 3", MAX_RECORDINGS_PER_SESSION, 3);
expect("4th take refused", canStartRecording({ roomStatus: "live", isRecording: false, takesSoFar: 3 }), { ok: false, reason: "limit-reached" });
expect("3rd take allowed", canStartRecording({ roomStatus: "live", isRecording: false, takesSoFar: 2 }), { ok: true });
expect("ended room refused", canStartRecording({ roomStatus: "ended", isRecording: false, takesSoFar: 0 }), { ok: false, reason: "room-ended" });
expect("End warning counts undownloaded", undownloadedTakes([{ downloaded_at: null }, { downloaded_at: "x" }]), 1);

console.log("Routing");
expect("room link", roomHref({ id: "r1", room_format: "audition" }), "/social/auditions/r1");
expect("exit", roomExitHref("callback"), "/social/auditions");
expect("create", roomCreateHref("table_read"), "/social/auditions/create");

console.log("Media");
const media = (role: "speaker" | "audience") =>
  decideRoomPublish({ roomFormat: "audition", hostId: "h", userId: "u", role, hostMuted: false, reservations: [], requested: ["camera", "microphone"] }).allowedSources;
expect("admitted reader: camera + mic", media("speaker"), ["camera", "microphone"]);
expect("not on stage: nothing", media("audience"), []);
expect("plain Space still audio only",
  decideRoomPublish({ roomFormat: "discussion", hostId: "h", userId: "u", role: "speaker", hostMuted: false, reservations: [], requested: ["camera", "microphone"] }).allowedSources,
  ["microphone"]);

console.log("Wiring (source contracts)");
const token = read("src/app/api/livekit-token/route.ts");
expect("token route gates audition rooms on admitted access", /isAuditionFormat\(space\.room_format\)[\s\S]{0,400}space_access[\s\S]{0,400}!== "admitted"/.test(token), true);
expect("Mirror live ring excludes auditions", read("src/app/api/mirror/live/route.ts").includes("AUDITION_ROOM_FORMATS"), true);
expect("Spaces list excludes auditions", read("src/app/social/spaces/page.tsx").includes("AUDITION_ROOM_FORMATS"), true);
for (const r of ["start", "publish", "discard"]) {
  expect(`Mirror recording ${r} refuses audition rooms`, read(`src/app/api/mirror/recording/${r}/route.ts`).includes("isAuditionFormat(space.room_format)"), true);
}
for (const r of ["participants", "comments", "reactions"]) {
  expect(`${r} GET guards private rooms`, read(`src/app/api/social/spaces/[spaceId]/${r}/route.ts`).includes("refusePrivateRoomRead"), true);
}
expect("presence reaper skips auditions", read("src/app/api/cron/mm-presence-reap/route.ts").includes("isAuditionFormat(s.room_format)"), true);
const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
expect("cleanup cron scheduled", vercel.crons.some((c) => c.path === "/api/cron/audition-cleanup"), true);
const migration = read("supabase/migrations/094_mm_auditions.sql");
for (const v of ["live_solo", "live_duo", "live_group", "cinema", "versus_battle", "table_read", "audition", "callback"]) {
  expect(`room_format check keeps ${v}`, migration.includes(`'${v}'`), true);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall auditions checks passed");
