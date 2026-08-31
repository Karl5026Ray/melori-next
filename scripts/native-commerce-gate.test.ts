import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NATIVE_UA_TOKEN,
  isBlockedNativeApi,
  isBlockedNativePage,
  isNativeUserAgent,
} from "../src/lib/nativePlatform";

const ROOT = join(__dirname, "..");

let checks = 0;
let failures = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (actual === expected) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

console.log("\niOS App Store commerce gate (Guideline 3.1.1)\n");

const NATIVE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 " +
  `(KHTML, like Gecko) Mobile/15E148 ${NATIVE_UA_TOKEN}`;
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

expect("native WebView UA is detected", isNativeUserAgent(NATIVE_UA), true);
expect("mobile Safari is not detected", isNativeUserAgent(SAFARI_UA), false);
expect("missing UA is not detected", isNativeUserAgent(null), false);

for (const path of [
  "/donate",
  "/donate/success",
  "/checkout",
  "/cart",
  "/store",
  "/store/cart",
  "/pricing",
  "/book",
  "/membership",
]) {
  expect(`${path} is blocked in the app`, isBlockedNativePage(path), true);
}

expect("/register (no tier) stays open", isBlockedNativePage("/register"), false);
expect("/register?tier=free stays open", isBlockedNativePage("/register", "free"), false);
for (const tier of ["artist", "superfan", "snappd"]) {
  expect(`/register?tier=${tier} is blocked`, isBlockedNativePage("/register", tier), true);
}

for (const path of [
  "/",
  "/music",
  "/music/12",
  "/stories",
  "/bookmarks",
  "/membership-success",
  "/social/spaces",
  "/account-info",
]) {
  expect(`${path} is not blocked`, isBlockedNativePage(path), false);
}

for (const path of [
  "/api/donate/checkout",
  "/api/music/checkout",
  "/api/store/checkout",
  "/api/gallery/checkout",
  "/api/gifts/checkout",
  "/api/booking/create",
]) {
  expect(`${path} is refused in the app`, isBlockedNativeApi(path), true);
}

for (const path of [
  "/api/gifts",
  "/api/gifts/send",
  "/api/gifts/wallet",
  "/api/music/download",
  "/api/members/stripe-webhook",
  "/api/music/checkout-history",
]) {
  expect(`${path} is not refused`, isBlockedNativeApi(path), false);
}

const proxySource = readFileSync(join(ROOT, "src", "proxy.ts"), "utf8");
for (const path of [
  "/api/donate/checkout",
  "/api/music/checkout",
  "/api/store/checkout",
  "/api/gallery/checkout",
  "/api/gifts/checkout",
  "/api/booking/create",
]) {
  expect(`proxy matcher lists ${path}`, proxySource.includes(`"${path}"`), true);
}

const nativeCss = readFileSync(join(ROOT, "src", "app", "native-app.css"), "utf8");
for (const route of [
  "/donate",
  "/checkout",
  "/cart",
  "/store",
  "/pricing",
  "/book",
  "/membership",
]) {
  expect(
    `CSS exactly matches ${route}`,
    nativeCss.includes(`a[href="${route}"]`),
    true,
  );
  expect(
    `CSS slash-prefix matches ${route}`,
    nativeCss.includes(`a[href^="${route}/"]`),
    true,
  );
}
expect(
  "CSS does not overmatch /bookmarks",
  nativeCss.includes('a[href^="/book"]'),
  false,
);
expect(
  "CSS scopes paid tier links to /register",
  nativeCss.includes('a[href^="/register?"][href*="tier=artist"]'),
  true,
);

const capacitorConfig = JSON.parse(
  readFileSync(join(ROOT, "mobile", "capacitor.config.json"), "utf8"),
) as {
  appendUserAgent?: string;
  server?: { allowNavigation?: string[] };
};

expect(
  `capacitor appendUserAgent carries "${NATIVE_UA_TOKEN}"`,
  capacitorConfig.appendUserAgent?.includes(NATIVE_UA_TOKEN) ?? false,
  true,
);
expect(
  "capacitor allowNavigation contains no Stripe host",
  (capacitorConfig.server?.allowNavigation ?? []).some((host) =>
    host.includes("stripe.com"),
  ),
  false,
);

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED\n` : "\n"),
);
process.exit(failures ? 1 : 0);
