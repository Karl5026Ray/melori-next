/* eslint-disable no-console */
// scripts/native-hidden.test.ts
//
// Pins WHAT THE NATIVE APP CANNOT REACH. Melori Connect (18+) stays out of the
// iOS/Android app so the store content rating (Teen / 12+) holds. The website
// is unchanged.
//
// Run:  npx tsx scripts/native-hidden.test.ts

import { isHiddenInNativeApp } from "@/lib/nativeHidden";
import { isNativeUserAgent } from "@/lib/nativePlatform";
import { CONNECT_NAV_ITEM, SOCIAL_NAV_ITEMS, MIRROR_NAV_ITEM } from "@/lib/socialNav";

let failures = 0;
function expect(label: string, actual: boolean, wanted: boolean) {
  if (actual === wanted) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label} (got ${actual}, wanted ${wanted})`); }
}

console.log("hidden in the app");
for (const p of ["/connect", "/connect/", "/connect?ref=x", "/social/connect", "/social/connect/matches", CONNECT_NAV_ITEM.href]) {
  expect(p, isHiddenInNativeApp(p), true);
}

console.log("still reachable in the app");
for (const p of ["/", "/books", "/social/connections", "/connections", "/connected", "/api/studio/calendar/connect", "/social/mirror", MIRROR_NAV_ITEM.href, ...SOCIAL_NAV_ITEMS.map((i) => i.href)]) {
  expect(p, isHiddenInNativeApp(p), false);
}

console.log("native user agent");
expect("Android WebView + MeloriApp", isNativeUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36 MeloriApp"), true);
expect("plain Chrome", isNativeUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/129 Mobile Safari/537.36"), false);
expect("no UA", isNativeUserAgent(null), false);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall native-hidden checks passed");
