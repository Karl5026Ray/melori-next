/* eslint-disable no-console */
// scripts/cinema-stage.test.ts
//
// Pins Cinema's podcast stage (src/lib/cinemaStage.ts) and its wiring:
//   • three seats, host first, then two guests in roster order;
//   • the two-guest cap is enforced by the participants route, not only the UI;
//   • elevated members are never auto-seated in Cinema;
//   • Cinema is audio-only: no camera request, no camera control;
//   • chat is a persistent panel with host / mod / author delete, and a banned
//     user cannot post.
//
// Run:  npx tsx scripts/cinema-stage.test.ts

import { readFileSync } from "node:fs";
import {
  CINEMA_GUEST_SEATS,
  buildCinemaAudioSeats,
  canDeleteRoomComment,
  cinemaGuestCount,
  cinemaStageHasRoom,
} from "@/lib/cinemaStage";

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

const HOST = "host";
const row = (user_id: string, role: string, left_at: string | null = null) => ({
  user_id,
  role,
  left_at,
});

console.log("\nSeats");
{
  const { seats, overflow } = buildCinemaAudioSeats(
    [row("a", "audience"), row("g1", "speaker"), row(HOST, "host"), row("g2", "speaker")],
    HOST,
  );
  expect(seats[0]?.user_id === HOST, "seat 0 is always the host");
  expect(seats[1]?.user_id === "g1" && seats[2]?.user_id === "g2", "guests keep roster order");
  expect(overflow.length === 0, "no overflow with two guests");
}
{
  const { seats } = buildCinemaAudioSeats([row(HOST, "host")], HOST);
  expect(seats.length === 3 && seats[1] === null && seats[2] === null, "empty guest seats are null");
}
{
  const { seats } = buildCinemaAudioSeats(
    [row(HOST, "host"), row("gone", "speaker", "2026-10-01T00:00:00Z"), row("g1", "speaker")],
    HOST,
  );
  expect(seats[1]?.user_id === "g1", "a speaker who left does not hold a seat");
}
{
  const { seats, overflow } = buildCinemaAudioSeats(
    [row(HOST, "host"), row("g1", "speaker"), row("g2", "speaker"), row("g3", "speaker")],
    HOST,
  );
  expect(
    seats[2]?.user_id === "g2" && overflow.length === 1 && overflow[0].user_id === "g3",
    "a legacy third speaker is returned as overflow, not dropped",
  );
}

console.log("\nCap");
expect(CINEMA_GUEST_SEATS === 2, "two guest seats");
expect(
  cinemaGuestCount([row(HOST, "host"), row("g1", "speaker"), row("a", "audience")], HOST) === 1,
  "the host and listeners do not count as guests",
);
expect(
  cinemaStageHasRoom([row(HOST, "host"), row("g1", "speaker")], HOST, "new"),
  "one guest up: room for another",
);
expect(
  !cinemaStageHasRoom([row(HOST, "host"), row("g1", "speaker"), row("g2", "speaker")], HOST, "new"),
  "two guests up: full",
);
expect(
  cinemaStageHasRoom([row(HOST, "host"), row("g1", "speaker"), row("g2", "speaker")], HOST, "g2"),
  "re-promoting someone already seated is never refused",
);

console.log("\nChat delete permission");
expect(canDeleteRoomComment({ callerId: HOST, authorId: "x", hostId: HOST }), "host can delete anyone");
expect(
  canDeleteRoomComment({ callerId: "m", authorId: "x", hostId: HOST, callerBadge: "mod" }),
  "moderator can delete anyone",
);
expect(canDeleteRoomComment({ callerId: "x", authorId: "x", hostId: HOST }), "author can delete their own");
expect(
  !canDeleteRoomComment({ callerId: "y", authorId: "x", hostId: HOST }),
  "a listener cannot delete someone else's message",
);
expect(
  !canDeleteRoomComment({ callerId: "y", authorId: null, hostId: HOST }),
  "an authorless message is host / mod only",
);

console.log("\nWiring");
const read = (path: string) => readFileSync(path, "utf8");
const roomScreen = read("src/components/social/rooms/RoomScreen.tsx");
const participantsRoute = read("src/app/api/social/spaces/[spaceId]/participants/[userId]/route.ts");
const commentsRoute = read("src/app/api/social/spaces/[spaceId]/comments/route.ts");
const deleteRoute = read("src/app/api/social/spaces/[spaceId]/comments/[commentId]/route.ts");
const commentsHook = read("src/components/social/rooms/useRoomComments.ts");
const cinemaStage = read("src/components/social/cinema/CinemaStage.tsx");
const cinemaChat = read("src/components/social/cinema/CinemaChat.tsx");

expect(
  participantsRoute.includes('body.role === "speaker" && space.room_format === "cinema"') &&
    participantsRoute.includes("cinemaStageHasRoom(stageRows ?? [], space.host_id, params.userId)") &&
    participantsRoute.includes("status: 409"),
  "participants route refuses a third guest with 409",
);
expect(
  roomScreen.includes('const elevatedTakesStage = isElevated && space?.room_format !== "cinema"'),
  "membership tier never auto-seats anyone in Cinema",
);
expect(
  roomScreen.includes("autoEnableCamera: false") &&
    !roomScreen.includes("setCinemaCameraEnabled") &&
    !roomScreen.includes("cinema-camera-toggle") &&
    !roomScreen.includes("cinema-camera-slot"),
  "Cinema never requests a camera and has no camera control",
);
expect(
  !/Camera|<video|videoElement/.test(cinemaStage) && cinemaStage.includes('data-testid="cinema-audio-seat"'),
  "the stage renders audio seats only",
);
expect(
  roomScreen.includes("buildCinemaAudioSeats(withSpeaking, hostId)") &&
    roomScreen.includes("<CinemaStage") &&
    roomScreen.includes("seats={cinemaSeats}"),
  "RoomScreen seats Cinema from the shared rule",
);
expect(
  /\{canSpeakNow && \(\s*<button/.test(roomScreen) &&
    roomScreen.includes("{!isHost && !canSpeakNow && canRaiseHandNow && ("),
  "mic and raise-hand render in Cinema too",
);
expect(
  roomScreen.includes('data-testid="cinema-leave"') &&
    roomScreen.includes('isHost ? openCinemaSheet("leave") : void handleLeave()') &&
    roomScreen.includes("handleEndSpace(true)"),
  "host leave asks hand-off vs end; everyone else leaves quietly",
);
expect(
  roomScreen.includes('data-testid="cinema-hands-queue"') &&
    roomScreen.includes("invitePromote(p.user_id)"),
  "host / moderators get the raised-hands queue",
);
expect(roomScreen.includes("{ ban: true }"), "host can remove and ban from the sheet");
expect(
  roomScreen.includes("chat={") &&
    roomScreen.includes("<CinemaChat") &&
    roomScreen.includes("onDelete={(id) => void deleteComment(id)}") &&
    roomScreen.includes("composer={user && isJoined ? commentComposer : undefined}"),
  "Cinema mounts the persistent chat panel with delete and the composer",
);
expect(
  !cinemaChat.includes("slice(-5)") && !cinemaChat.includes("TTL") && cinemaChat.includes('role="log"'),
  "chat is a persistent log, not a fading overlay",
);
expect(
  commentsRoute.includes('.from("space_bans")') && commentsRoute.includes("status: 403"),
  "a banned user cannot post in chat",
);
expect(
  deleteRoute.includes("canDeleteRoomComment(") && deleteRoute.includes("status: 403"),
  "delete route checks host / mod / author server-side",
);
expect(
  commentsHook.includes('event: "DELETE"') && commentsHook.includes("deleteComment"),
  "deletes reach every open room through realtime",
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
