/* eslint-disable no-console */
// Deterministic checks for the Cinema <-> Spaces route split.
//
// Cinema rooms are `spaces` rows, so for a long time every link to one was
// hardcoded to /social/spaces/<id> across six call sites and Cinema kept
// surfacing as part of Spaces. These helpers are now the single place that
// decides, so they are worth pinning: a regression here silently reattaches
// Cinema to Spaces without breaking a build or a type.

import {
  CINEMA_ROOM_FORMAT,
  roomCreateHref,
  roomExitHref,
  roomHref,
  roomScheduledHref,
} from "@/lib/cinema";

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

console.log("roomHref — a room links to its own product");
assertEq(
  "cinema room -> cinema route",
  roomHref({ id: "abc", room_format: CINEMA_ROOM_FORMAT }),
  "/social/cinema/abc",
);
assertEq(
  "audio space -> spaces route",
  roomHref({ id: "abc", room_format: "discussion" }),
  "/social/spaces/abc",
);
assertEq(
  "release party -> spaces route",
  roomHref({ id: "abc", room_format: "release_party" }),
  "/social/spaces/abc",
);
// Legacy rooms predate room_format and hold null. They are Spaces, not Cinema.
assertEq(
  "null format -> spaces route",
  roomHref({ id: "abc", room_format: null }),
  "/social/spaces/abc",
);
assertEq(
  "missing format -> spaces route",
  roomHref({ id: "abc" }),
  "/social/spaces/abc",
);
// A missing room must not produce "/social/spaces/undefined".
assertEq("null room -> spaces list", roomHref(null), "/social/spaces");
assertEq("undefined room -> spaces list", roomHref(undefined), "/social/spaces");
assertEq(
  "empty id -> spaces list",
  roomHref({ id: "", room_format: CINEMA_ROOM_FORMAT }),
  "/social/spaces",
);

console.log("roomCreateHref — hosting starts on the right form");
assertEq(
  "cinema -> its own create route",
  roomCreateHref(CINEMA_ROOM_FORMAT),
  "/social/cinema/create",
);
assertEq(
  "audio space -> Start a Space",
  roomCreateHref("dj_set"),
  "/social/spaces/create",
);
assertEq("null -> Start a Space", roomCreateHref(null), "/social/spaces/create");
// The old entry point must not come back: Cinema creation is no longer a
// preselected format on the Spaces form.
assertEq(
  "cinema create is not the spaces form with a query",
  roomCreateHref(CINEMA_ROOM_FORMAT).includes("format=cinema"),
  false,
);

console.log("exits and scheduling still route by format");
assertEq("cinema exit", roomExitHref(CINEMA_ROOM_FORMAT), "/social/cinema");
assertEq("space exit", roomExitHref("discussion"), "/social/spaces");
assertEq(
  "cinema scheduled",
  roomScheduledHref(CINEMA_ROOM_FORMAT),
  "/social/cinema",
);
assertEq(
  "space scheduled",
  roomScheduledHref("discussion"),
  "/social/spaces?tab=scheduled",
);

console.log("round trip — every helper agrees on what Cinema is");
for (const helper of [roomExitHref, roomScheduledHref, roomCreateHref]) {
  assertEq(
    `${helper.name} sends cinema to a /social/cinema path`,
    helper(CINEMA_ROOM_FORMAT).startsWith("/social/cinema"),
    true,
  );
  assertEq(
    `${helper.name} never sends cinema to a /social/spaces path`,
    helper(CINEMA_ROOM_FORMAT).startsWith("/social/spaces"),
    false,
  );
}

if (failures > 0) {
  console.error(`\n${failures} failing assertion(s)`);
  process.exit(1);
}
console.log("\nAll Cinema routing assertions passed.");
