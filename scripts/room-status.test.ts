/* eslint-disable no-console */
import {
  getLiveRoomPresentation,
  ONLINE_PRESENCE_PRESENTATION,
} from "@/lib/roomStatus";
import { isMediaRoomRoute } from "@/lib/mediaRoomRoute";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(
    `  FAIL ${name}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`,
  );
}

console.log("Mirror room status presentation");
for (const format of ["live_solo", "live_duo", "live_group"]) {
  const result = getLiveRoomPresentation({
    id: "room-1",
    status: "live",
    room_format: format,
  });
  assertEq(`${format} uses orange Faces ring`, result?.tone, "orange");
  assertEq(`${format} routes to Faces`, result?.href, "/social/live/room-1");
}

const concert = getLiveRoomPresentation({
  id: "room-2",
  status: "live",
  room_format: "versus_battle",
});
assertEq("Concert uses teal", concert?.tone, "teal");
assertEq("Concert is visibly labeled", concert?.label, "Concert");
assertEq("Concert routes to its dedicated screen", concert?.href, "/social/concert/room-2");

for (const format of ["discussion", "release_party", "dj_set", null, "legacy"]) {
  const result = getLiveRoomPresentation({
    id: "room-3",
    status: "live",
    room_format: format,
  });
  assertEq(`${String(format)} uses purple Spaces ring`, result?.tone, "purple");
  assertEq(`${String(format)} routes to Spaces`, result?.href, "/social/spaces/room-3");
}

const cinema = getLiveRoomPresentation({
  id: "room-4",
  status: "live",
  room_format: "cinema",
});
assertEq("Cinema uses gold", cinema?.tone, "gold");
assertEq("Cinema routes to Cinema", cinema?.href, "/social/cinema/room-4");
assertEq(
  "ended rooms do not receive a live ring",
  getLiveRoomPresentation({
    id: "room-5",
    status: "ended",
    room_format: "cinema",
  }),
  null,
);
assertEq("online ring is neutral", ONLINE_PRESENCE_PRESENTATION.tone, "neutral-green");
assertEq(
  "online state is explicit",
  ONLINE_PRESENCE_PRESENTATION.ariaLabel,
  "Online, not in a room",
);

console.log("Global music transport room suppression");
assertEq("Cinema room suppresses transport", isMediaRoomRoute("/social/cinema/abc"), true);
assertEq(
  "Cinema room trailing slash suppresses transport",
  isMediaRoomRoute("/social/cinema/abc/"),
  true,
);
assertEq("Cinema discover keeps transport", isMediaRoomRoute("/social/cinema"), false);
assertEq("Cinema create keeps transport", isMediaRoomRoute("/social/cinema/create"), false);
assertEq(
  "Cinema nested route keeps transport",
  isMediaRoomRoute("/social/cinema/abc/controls"),
  false,
);
assertEq("Concert room suppresses transport", isMediaRoomRoute("/social/concert/abc"), true);
assertEq("Concert landing keeps transport", isMediaRoomRoute("/social/concert"), false);
assertEq("Concert create keeps transport", isMediaRoomRoute("/social/concert/create"), false);
assertEq("Spaces room suppresses transport", isMediaRoomRoute("/social/spaces/abc"), true);
assertEq("Spaces create keeps transport", isMediaRoomRoute("/social/spaces/create"), false);

if (failures > 0) {
  console.error(`\n${failures} failing assertion(s)`);
  process.exit(1);
}
console.log("\nAll room status assertions passed.");
