/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import {
  COIN_PACK_SOURCE,
  canSendGiftInRoom,
  coinPackCreditReference,
  giftMediaKind,
  isCoinPackCheckoutMetadata,
} from "@/lib/gifting";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown = true) {
  if (actual === expected) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

console.log("\nGifting pure contracts\n");

check("MP4 catalog assets render as video", giftMediaKind("/gifts/trumpet_packed.mp4"), "video");
check("animated GIF catalog assets render as images", giftMediaKind("/gifts/spark.gif?cache=1"), "image");
check("GLB catalog assets render as a 3D model", giftMediaKind("/gifts/record_player.glb"), "model");
check(
  "active Concert participant can send to active speaker",
  canSendGiftInRoom({
    roomFormat: "versus_battle",
    roomStatus: "live",
    sender: { user_id: "fan", role: "audience" },
    target: { user_id: "artist", role: "speaker" },
    hostId: "host",
  }),
);
check(
  "generic Spaces are never gifting-enabled",
  canSendGiftInRoom({
    roomFormat: "discussion",
    roomStatus: "live",
    sender: { user_id: "fan", role: "audience" },
    target: { user_id: "host", role: "host" },
    hostId: "host",
  }),
  false,
);
check(
  "ended Concert rooms are never gifting-enabled",
  canSendGiftInRoom({
    roomFormat: "versus_battle",
    roomStatus: "ended",
    sender: { user_id: "fan", role: "audience" },
    target: { user_id: "host", role: "host" },
    hostId: "host",
  }),
  false,
);
check(
  "coin pack metadata requires source, pack and user",
  isCoinPackCheckoutMetadata({
    source: COIN_PACK_SOURCE,
    pack_id: "fan",
    user_id: "00000000-0000-0000-0000-000000000000",
  }),
);
check(
  "ordinary checkout metadata is not coin fulfillment",
  isCoinPackCheckoutMetadata({ source: "melorimusic.org/store", pack_id: "fan", user_id: "u" }),
  false,
);
check(
  "wallet credit reference is stable across Stripe retries",
  coinPackCreditReference("cs_test_same") === coinPackCreditReference("cs_test_same"),
);
check(
  "distinct Stripe sessions have distinct wallet references",
  coinPackCreditReference("cs_test_a") === coinPackCreditReference("cs_test_b"),
  false,
);

const sidebarSource = readFileSync(
  new URL("../src/components/social/layout/Sidebar.tsx", import.meta.url),
  "utf8",
);
const mobileNavSource = readFileSync(
  new URL("../src/components/MobileTabBar.tsx", import.meta.url),
  "utf8",
);
const concertCreateSource = readFileSync(
  new URL("../src/app/social/concert/create/page.tsx", import.meta.url),
  "utf8",
);
const concertFormSource = readFileSync(
  new URL("../src/components/social/concert/ConcertCreateForm.tsx", import.meta.url),
  "utf8",
);

check(
  "desktop Concert opens the dedicated Concert creator",
  sidebarSource.includes('href="/social/concert/create"'),
);
check(
  "mobile Concert opens the dedicated Concert creator",
  mobileNavSource.includes('router.push("/social/concert/create")'),
);
check(
  "desktop Concert does not fall back to the Spaces creator",
  sidebarSource.includes('href="/social/spaces/create?format=versus_battle"'),
  false,
);
check("dedicated Concert creator renders its atomic form", concertCreateSource.includes("<ConcertCreateForm />"));
check(
  "Concert creation uses its battle RPC instead of generic spaces creation",
  concertFormSource.includes('authFetch("/api/concert/battles"') &&
    !concertFormSource.includes("/api/social/spaces"),
);

console.log(failures ? `\n${failures} failure(s)\n` : "\nAll gifting contracts passed.\n");
process.exit(failures ? 1 : 0);
