/* eslint-disable no-console */
// scripts/native-commerce-affordances.test.ts
//
// GUARD TEST for the failure that caused three Guideline 3.1.1 rejections.
//
// scripts/native-commerce-gate.test.ts already pins the ROUTE gate — which
// pages and APIs the proxy blocks, and which anchors the CSS hides. It passed
// the whole time the app was being rejected, because the leak was never a
// route or an anchor. It was AFFORDANCES: a price rendered in a <span>, a
// purchase call to action rendered as a <button> that router.push()es. Neither
// is an <a href>, so no route selector could ever see them.
//
// Why CSS and not server rendering: the home page (and the catalog pages that
// carry prices) are ISR-cached — `export const revalidate = 60` — deliberately,
// because `force-dynamic` makes Next stamp `no-store`, which iOS WKWebView
// treats as "this page couldn't load" (see the comment block at the top of
// src/app/page.tsx, issue #280). One cached HTML body is shared by web and app
// visitors, so the SERVER CANNOT KNOW THE PLATFORM. The pre-paint CSS in
// src/app/native-app.css keyed on `data-native-hide` is the only mechanism that
// works without breaking the app's ability to load at all.
//
// So: any price or purchase CTA outside a proxy-blocked route must carry
// `data-native-hide`, or be gated by `useIsNativeApp()`, or be listed in
// ALLOWED below with a reason. Pure file I/O, no DB and no network.
//
// Run:  npx tsx scripts/native-commerce-affordances.test.ts

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

// Routes the proxy already redirects to /account-info for native requests.
// Anything under these directories is unreachable inside the wrapper.
const BLOCKED_ROUTE_DIRS = [
  "app/donate", "app/checkout", "app/cart", "app/store",
  "app/pricing", "app/book", "app/membership",
];

// Files exempt for a stated reason. An entry here is a claim someone can check.
const ALLOWED = new Map<string, string>([
  ["app/studio", "Seller-side tooling: an artist setting the price of their own release, not a purchase affordance offered to a buyer."],
  ["app/admin", "Admin-only surface behind a role check; not reachable by a reviewer's test account."],
  ["components/MobileTabBar.tsx", "Prices live in `desc` strings on <Link> tiles whose hrefs (/pricing, /book, /register?tier=) are already covered by the route selectors in native-app.css, so the tile and its text are hidden together."],
  ["lib/pricing.ts", "Server-side price floors, never rendered."],
  ["app/register/page.tsx", "The tier list is a data constant; the grid that renders it carries data-native-hide on every paid tier, pinned by name in PINNED below."],
]);

// Route prefixes the proxy redirects and native-app.css hides anchors to. A CTA
// rendered as a link to one of these is already covered by the route selectors.
const COVERED_HREF = /href=["'](\/(donate|checkout|cart|store|pricing|book|membership)([/?#"']|$)|https:\/\/(buy|checkout)\.stripe\.com)/;

// A literal dollar amount, or a purchase call to action.
const PRICE = /\$\s?\d/;
const CTA = /\b(Upgrade\s*—|Become a Superfan|Go Superfan|Add to Cart|Buy a single|Buy digital|Purchase watermark|Subscribe now|Donate)\b/;
const MARKERS = /data-native-hide|useIsNativeApp|isNativeApp/;
const LOOKBACK = 15;

let checks = 0;
let failures = 0;
function pass(label: string) { checks += 1; console.log(`  ok    ${label}`); }
function fail(label: string) { checks += 1; failures += 1; console.log(`  FAIL  ${label}`); }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const leaks: { file: string; line: number; text: string }[] = [];

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split("\\").join("/");
  if (BLOCKED_ROUTE_DIRS.some((d) => rel.startsWith(d))) continue;
  // API handlers render no UI; their checkout paths are blocked by the proxy.
  if (rel.startsWith("app/api/")) continue;
  if ([...ALLOWED.keys()].some((k) => rel.startsWith(k))) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Skip comments — this test's own prose mentions prices.
    const code = line.trim();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
    if (!PRICE.test(code) && !CTA.test(code)) return;
    // Template literals building a price from data are fine if the surrounding
    // markup is gated; look back for the marker.
    const window = lines.slice(Math.max(0, i - LOOKBACK), i + 1).join("\n");
    if (MARKERS.test(window)) return;
    // An <a>/<Link> pointing at a blocked route is hidden by the route
    // selectors in native-app.css, text and all.
    if (COVERED_HREF.test(window)) return;
    leaks.push({ file: rel, line: i + 1, text: code.slice(0, 90) });
  });
}

if (leaks.length === 0) {
  pass("no ungated price or purchase CTA outside proxy-blocked routes");
} else {
  fail(`${leaks.length} ungated commerce affordance(s) reachable inside the native wrapper`);
  for (const l of leaks) console.log(`        ${l.file}:${l.line}  ${l.text}`);
}

// The specific sites that caused the August 2026 rejections. Pinned by name so
// a future refactor cannot quietly drop the marker.
const PINNED: [string, string][] = [
  ["components/AudioPlayer.tsx", "the 30-second-preview upgrade banner"],
  ["components/CatalogCard.tsx", "the price on every catalog card"],
  ["app/music/[id]/page.tsx", "the single-track price"],
  ["app/music/album/[slug]/page.tsx", "the album price"],
  ["app/gallery/page.tsx", "the 'Buy digital copies ... via Stripe' feature"],
  ["app/page.tsx", "the home value-prop cards about buying and selling"],
  ["components/social/rooms/RoomChat.tsx", "the Go Superfan button in room chat"],
  ["components/social/faces/FacesLiveChat.tsx", "the Go Superfan button in Faces chat"],
  ["app/register/page.tsx", "the paid signup tiers"],
];
for (const [rel, what] of PINNED) {
  const src = readFileSync(join(SRC, rel), "utf8");
  if (src.includes("data-native-hide")) pass(`${what} is marked data-native-hide`);
  else fail(`${what} lost its data-native-hide marker (${rel})`);
}

// The /register tier grid gates by tier id rather than a plain marker, so pin
// the exact expression.
const registerSrc = readFileSync(join(SRC, "app/register/page.tsx"), "utf8");
if (registerSrc.includes('data-native-hide={t.id === "free" ? undefined : ""}')) {
  pass("the /register grid still hides every paid tier natively");
} else {
  fail("the /register grid no longer hides paid tiers natively");
}

// The CSS hook the markers depend on must exist.
const css = readFileSync(join(SRC, "app/native-app.css"), "utf8");
if (/\[data-native-hide\]/.test(css) && /display:\s*none\s*!important/.test(css)) {
  pass("native-app.css still hides [data-native-hide] with display:none !important");
} else {
  fail("native-app.css no longer hides [data-native-hide]");
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
