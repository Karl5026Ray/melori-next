/* eslint-disable no-console */
// Deterministic checks for Cinema's durable reservation -> publish-source
// policy. No database/LiveKit dependency: migration/RPC capacity enforcement
// and token/runtime callers consume the same answers.

import {
  buildCinemaSlotAssignments,
  decidePublishedCameraEnforcement,
  decideRoomPublish,
  type CinemaReservation,
  type RoomMediaInput,
} from "@/lib/roomMediaPolicy";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(
      `  FAIL ${name}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`,
    );
  }
}

const host = "host";
const guestOne = "guest-one";
const guestTwo = "guest-two";
const guestThree = "guest-three";
const reservations: CinemaReservation[] = [
  { slot: 0, userId: host },
  { slot: 1, userId: guestOne },
  { slot: 2, userId: guestTwo },
];

function input(overrides: Partial<RoomMediaInput> = {}): RoomMediaInput {
  return {
    roomFormat: "cinema",
    hostId: host,
    userId: host,
    role: "host",
    hostMuted: false,
    reservations,
    requested: ["camera", "microphone"],
    ...overrides,
  };
}

console.log("\nCinema fixed slots");
assertEq(
  "host and exactly two guests map to exactly three stable seats",
  buildCinemaSlotAssignments(host, reservations),
  [
    { slot: 0, userId: host },
    { slot: 1, userId: guestOne },
    { slot: 2, userId: guestTwo },
  ],
);
assertEq(
  "host stays in slot zero while camera is off (no track involved in mapping)",
  buildCinemaSlotAssignments(host, [{ slot: 0, userId: host }]),
  [
    { slot: 0, userId: host },
    { slot: 1, userId: null },
    { slot: 2, userId: null },
  ],
);

console.log("\nCinema source grants");
assertEq("host camera + mic", decideRoomPublish(input()).allowedSources, ["camera", "microphone"]);
assertEq(
  "guest one camera + mic",
  decideRoomPublish(input({ userId: guestOne, role: "speaker" })).allowedSources,
  ["camera", "microphone"],
);
assertEq(
  "guest two camera + mic",
  decideRoomPublish(input({ userId: guestTwo, role: "speaker" })).allowedSources,
  ["camera", "microphone"],
);
assertEq(
  "speaker without reservation is microphone-only, never camera",
  decideRoomPublish(input({ userId: guestThree, role: "speaker" })),
  { allowedSources: ["microphone"], cameraSlot: null, reason: "no-camera-slot" },
);
assertEq(
  "audience is denied all media",
  decideRoomPublish(input({ userId: guestOne, role: "audience" })).allowedSources,
  [],
);
assertEq(
  "host-muted user is denied all media",
  decideRoomPublish(input({ userId: guestOne, role: "speaker", hostMuted: true })).allowedSources,
  [],
);

console.log("\nDelayed Cinema camera webhook");
assertEq(
  "valid publish is allowed while the guest owns a slot",
  decidePublishedCameraEnforcement(input({ userId: guestOne, role: "speaker" })),
  {
    allowedSources: ["camera", "microphone"],
    action: "allow",
    disconnect: false,
  },
);
assertEq(
  "delayed publish after Camera Off is muted without disconnecting audio",
  decidePublishedCameraEnforcement(
    input({
      userId: guestOne,
      role: "speaker",
      reservations: reservations.filter((reservation) => reservation.userId !== guestOne),
    }),
  ),
  {
    allowedSources: ["microphone"],
    action: "mute-camera",
    disconnect: false,
  },
);

console.log("\nCinema malformed reservations fail closed");
for (const [name, bad] of [
  ["fourth reservation", [...reservations, { slot: 2, userId: guestThree }]],
  ["duplicate slot", [{ slot: 0, userId: host }, { slot: 1, userId: guestOne }, { slot: 1, userId: guestTwo }]],
  ["duplicate user", [{ slot: 0, userId: host }, { slot: 1, userId: guestOne }, { slot: 2, userId: guestOne }]],
  ["invalid slot", [{ slot: 0, userId: host }, { slot: 3, userId: guestOne }]],
  ["wrong host owner", [{ slot: 0, userId: guestOne }]],
] as const) {
  assertEq(
    `${name} grants no camera or microphone`,
    decideRoomPublish(input({ reservations: bad })).allowedSources,
    [],
  );
}

console.log("\nNon-Cinema regression");
for (const roomFormat of ["discussion", "release_party", "dj_set", null]) {
  assertEq(
    `${String(roomFormat)} remains microphone-only`,
    decideRoomPublish(
      input({ roomFormat, userId: guestOne, role: "speaker", reservations: [] }),
    ).allowedSources,
    ["microphone"],
  );
}
assertEq(
  "live_* retains Faces camera policy",
  decideRoomPublish(
    input({ roomFormat: "live_group", userId: guestOne, role: "speaker", reservations: [] }),
  ).allowedSources,
  ["camera", "microphone"],
);

console.log(
  failures === 0
    ? "\nAll Cinema camera-policy assertions passed.\n"
    : `\n${failures} Cinema camera-policy assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
