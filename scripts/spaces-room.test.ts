/* eslint-disable no-console */
// scripts/spaces-room.test.ts
//
// Pins the MM Spaces room redesign (2 Oct 2026):
//   • stage rules: host first, speakers in roster order, cap enforced server-side;
//   • speaking rings follow live loudness; muted never rings;
//   • reminders: who gets emailed when (src/lib/spaceReminders.ts);
//   • Spaces and Cinema share NO room code (Karl's call) — each screen and its
//     components import nothing from the other product;
//   • report, follow state, followed-only hand raise and the reminder cron are wired.
//
// Run:  npx tsx scripts/spaces-room.test.ts

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SPACES_SPEAKER_LIMIT,
  buildSpacesStage,
  spacesRing,
  spacesSpeakerCount,
  spacesStageHasRoom,
} from "@/lib/spacesRoom";
import { reminderAction, REMINDER_LEAD_MS, REMINDER_STALE_AFTER_MS } from "@/lib/spaceReminders";
import { spacesAvatarColor, spacesInitials, SPACES_AVATAR_COLORS } from "@/lib/spacesAvatar";
import { spacesLevel, spacesLevelsChanged } from "@/lib/livekitClient";
import { handRaiseAllowed } from "@/lib/spacesStage";
import { isSpacesLiveRoomRoute } from "@/lib/spacesRoomRoute";

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

const HOST = "host";
const row = (user_id: string, role: string, left_at: string | null = null) => ({ user_id, role, left_at });

console.log("\nStage");
{
  const stage = buildSpacesStage(
    [row("a", "audience"), row("s1", "speaker"), row(HOST, "host"), row("s2", "speaker"), row("gone", "speaker", "x")],
    HOST,
  );
  expect(stage[0]?.user_id === HOST, "host is always first");
  expect(stage.map((p) => p.user_id).join() === "host,s1,s2", "speakers keep roster order; listeners and leavers excluded");
}
expect(SPACES_SPEAKER_LIMIT === 8, "eight speakers besides the host");
{
  const full = [row(HOST, "host"), ...Array.from({ length: 8 }, (_, i) => row(`s${i}`, "speaker"))];
  expect(spacesSpeakerCount(full, HOST) === 8, "host does not count toward the speaker limit");
  expect(!spacesStageHasRoom(full, HOST, "new"), "a ninth speaker is refused");
  expect(spacesStageHasRoom(full, HOST, "s3"), "re-promoting someone already up is never refused");
  expect(spacesStageHasRoom(full.slice(0, 8), HOST, "new"), "seven up: room for one more");
}

console.log("\nSpeaking rings");
expect(!spacesRing({ level: 0.9, speaking: true, muted: true }).active, "muted never rings");
expect(!spacesRing({ level: 0, speaking: false, muted: false }).active, "silent is still");
expect(spacesRing({ level: 0, speaking: true, muted: false }).active, "speaking flag rings before a level arrives");
expect(
  spacesRing({ level: 1, speaking: true, muted: false }).scale > spacesRing({ level: 0.3, speaking: true, muted: false }).scale,
  "louder grows the ring",
);
expect(spacesLevel(0.02) === 0 && spacesLevel(2) === 1 && spacesLevel("x") === 0, "levels clamp; room noise is zero");
expect(!spacesLevelsChanged({ a: 0.5 }, { a: 0.51 }) && spacesLevelsChanged({ a: 0.5 }, {}), "tiny changes don't re-render");

console.log("\nReminders");
const now = Date.parse("2026-10-02T20:00:00Z");
const at = (ms: number) => new Date(now + ms).toISOString();
expect(reminderAction({ status: "live", scheduledAt: null, endedAt: null, now }) === "live", "live room: email now");
expect(reminderAction({ status: "scheduled", scheduledAt: at(REMINDER_LEAD_MS - 1000), endedAt: null, now }) === "soon", "starts within 10 min: email");
expect(reminderAction({ status: "scheduled", scheduledAt: at(REMINDER_LEAD_MS + 60_000), endedAt: null, now }) === "wait", "further out: wait");
expect(reminderAction({ status: "ended", scheduledAt: null, endedAt: at(-1000), now }) === "skip", "ended: never email");
expect(
  reminderAction({ status: "scheduled", scheduledAt: at(-REMINDER_STALE_AFTER_MS - 1000), endedAt: null, now }) === "skip",
  "host never showed after 6h: skip",
);

console.log("\nLook");
expect(spacesAvatarColor("user-1") === spacesAvatarColor("user-1"), "a person keeps one color");
expect((SPACES_AVATAR_COLORS as readonly string[]).includes(spacesAvatarColor("x")), "colors come from the prototype palette");
expect(spacesInitials("Gloria Joy Rivers") === "GJ" && spacesInitials("") === "?", "initials");

console.log("\nFollowed-only hand raise");
expect(handRaiseAllowed("followed", { signedIn: true, followedByHost: true }), "host follows you: allowed");
expect(!handRaiseAllowed("followed", { signedIn: true, followedByHost: false }), "host doesn't follow you: refused");
const raiseRoute = read("src/app/api/social/spaces/[spaceId]/raise-hand/route.ts");
expect(
  raiseRoute.includes('.eq("follower_id", space.host_id)') && raiseRoute.includes("followedByHost"),
  "raise-hand route checks the follow server-side",
);

console.log("\nSeparation (no shared room code)");
const spacesFiles = [
  "src/components/social/spaces/SpacesRoomScreen.tsx",
  "src/components/social/spaces/SpacesStage.tsx",
  "src/components/social/spaces/SpacesListeners.tsx",
  "src/components/social/spaces/SpacesChat.tsx",
  "src/components/social/spaces/useSpaceChat.ts",
  "src/lib/spacesRoom.ts",
  "src/lib/spacesAvatar.ts",
];
const cinemaDir = "src/components/social/cinema";
const cinemaFiles = [
  ...readdirSync(cinemaDir).map((f) => join(cinemaDir, f)),
  "src/lib/cinemaStage.ts",
  "src/lib/cinemaAvatar.ts",
];
const importsOf = (src: string) => [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
expect(
  spacesFiles.every((f) =>
    importsOf(read(f)).every(
      (spec) =>
        !/social\/cinema\/|lib\/cinema|cinemaAvatar|livekitVideoClient|voiceCircles|rooms\/RoomScreen|rooms\/useRoomComments/.test(
          spec,
        ),
    ),
  ),
  "Spaces room code imports nothing from Cinema",
);
expect(
  cinemaFiles.every((f) =>
    importsOf(read(f)).every(
      (spec) => !/social\/spaces\/|spacesRoom|spacesAvatar|useSpaceChat|lib\/livekitClient/.test(spec),
    ),
  ),
  "Cinema room code imports nothing from Spaces",
);
const spacesPage = read("src/app/social/spaces/[spaceId]/page.tsx");
const cinemaPage = read("src/app/social/cinema/[roomId]/page.tsx");
expect(spacesPage.includes("return <SpacesRoomScreen") && !spacesPage.includes("Cinema" + "RoomScreen"), "Spaces route renders the Spaces screen");
expect(cinemaPage.includes("return <CinemaRoomScreen") && !cinemaPage.includes("Spaces" + "RoomScreen"), "Cinema route renders the Cinema screen");

console.log("\nWiring");
const screen = read("src/components/social/spaces/SpacesRoomScreen.tsx");
expect(screen.includes("<SpacesStage") && screen.includes("<SpacesListeners") && screen.includes("<SpacesChat"), "room is stage, listeners, chat");
expect(screen.includes("onAudioLevels: (levels) =>") && screen.includes("levels={audioLevels}"), "rings get live loudness");
expect(screen.includes('data-testid="spaces-leave"') && screen.includes('isHost ? openSheet("leave") : void handleLeave()'), "leave quietly; host chooses hand-off or end");
expect(screen.includes('data-testid="spaces-hands-queue"') && screen.includes("{canModerate && ("), "hands queue for host and moderators");
expect(screen.includes("if (!canModerate) return;"), "moderators can run the stage, not only the host");
expect(screen.includes('const joinRole = isHostJoining ? "host" : keepsStage ? existing!.role : "audience";'), "nobody but the host joins on stage");
expect(screen.includes('.from("follows")') && screen.includes('.in("following_id", ids)'), "follow state loads in one query");
expect(!screen.includes("alert(") && screen.includes('content_type: "space"') && screen.includes('content_type: "space_chat"'), "real report for the room and chat lines");
expect(!/window\.confirm|confirm\(/.test(screen), "no browser confirm dialogs");
const reportRoute = read("src/app/api/social/report/route.ts");
expect(reportRoute.includes('"space"') && reportRoute.includes('"space_chat"') && reportRoute.includes("await sendLiveRoomReportEmail"), "report route accepts rooms and emails Karl");
const participants = read("src/app/api/social/spaces/[spaceId]/participants/[userId]/route.ts");
expect(participants.includes("spacesStageHasRoom(stageRows ?? [], space.host_id, params.userId)"), "speaker cap enforced server-side");
const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
expect(vercel.crons.some((c) => c.path === "/api/cron/space-reminders"), "reminder cron is scheduled");
const cron = read("src/app/api/cron/space-reminders/route.ts");
expect(cron.includes('.is("notified_at", null)') && cron.includes("notified_at: new Date().toISOString()"), "each reminder is emailed once");
expect(cron.includes("notifications_email === false"), "reminders respect the email opt-out");
expect(isSpacesLiveRoomRoute("/social/spaces/abc") && !isSpacesLiveRoomRoute("/social/spaces/create") && !isSpacesLiveRoomRoute("/social/spaces"), "app chrome hides only inside a room");
expect(read("src/components/MobileTabBar.tsx").includes("isSpacesRoomRoute"), "tab bar hides in a Spaces room");

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
