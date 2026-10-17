/* eslint-disable no-console */
// scripts/app-link.test.ts — pins where melorimusic.org/app sends each phone.
// Run:  npx tsx scripts/app-link.test.ts

import { APP_STORE_URL, ANDROID_BETA_PATH, ANDROID_ON_PLAY_STORE, appLinkTarget } from "@/lib/appLinks";
import { PLAY_INSTALL_URL } from "@/lib/androidBeta";
import { isPublicPath } from "@/proxy";

let checks = 0;
let failures = 0;
const check = (label: string, cond: boolean) => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
  }
};

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

check("App Store link is the live Melori Music listing", APP_STORE_URL === "https://apps.apple.com/app/id6792791603");
check("iPhone goes to the App Store", appLinkTarget(IPHONE) === APP_STORE_URL);
check(
  "Android goes to Play when public, else the beta signup",
  appLinkTarget(ANDROID) === (ANDROID_ON_PLAY_STORE ? PLAY_INSTALL_URL : ANDROID_BETA_PATH),
);
check("desktop goes to the site", appLinkTarget(DESKTOP) === "/");
check("no user agent goes to the site", appLinkTarget(null) === "/");
check("/app is public (flyer scanners have no account)", isPublicPath("/app"));
check("/app/x is not", !isPublicPath("/app/x"));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
