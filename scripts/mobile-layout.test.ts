/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { isCinemaLiveRoomRoute } from "../src/lib/cinemaRoomRoute";
import { isTransportRoute } from "../src/lib/transportRoute";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

let failures = 0;
function check(label: string, value: boolean) {
  if (value) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

console.log("\nMobile navigation and Mirror layout contracts\n");

const nav = read("src/components/MobileTabBar.tsx");
const layout = read("src/app/layout.tsx");
const globals = read("src/app/globals.css");
const video = read("src/components/social/video/VideoCard.tsx");
const mainContent = read("src/components/MainContent.tsx");
const transportVisible = read("src/components/player/useTransportVisible.ts");
const player = read("src/components/AudioPlayer.tsx");
const hero = read("src/components/HomeHero.tsx");

check(
  "Chat remains the primary bottom-tab destination",
  nav.includes('label: "Chat", href: "/social/messages"'),
);
check(
  "Melori Connect occupies the former Messages quick tile",
  nav.includes("label: CONNECT_NAV_ITEM.label") &&
    nav.includes("href: CONNECT_NAV_ITEM.href"),
);
check(
  "the quick launcher no longer duplicates Messages",
  !nav.includes('label: "Messages"'),
);
// Was "Artists replaces Profile as the first M Menu quick tile". Artists is no
// longer first — Music leads the row now — but the thing this was
// really guarding is that Profile does not come back as a tile, since "You" in
// the bottom tab bar already goes there.
check(
  "Artists is an M Menu quick tile and Profile has not come back",
  nav.includes(
    'label: "Artists",\n      href: "/artists",\n      icon: <Users className="h-5 w-5" />,\n      desc: "Browse artists"',
  ) && !nav.includes('label: "Profile"'),
);
check(
  "Mission replaces More as a direct top-level M Menu item",
  nav.includes("const missionLink: LaunchItem = {") &&
    nav.includes('label: "Mission"') &&
    nav.includes('href: "/mission"') &&
    nav.includes("{renderTile(missionLink)}") &&
    !nav.includes('label: "More"') &&
    nav.match(/label: "Artists"/g)?.length === 1,
);
// THE M MENU. Karl, 2026-09-07: "the store is still in the M menu, place home
// there with all of the music."
//
// Store was not just clutter. Inside the native wrapper /store 307s to
// /account-info for App Review (PR #347), so the tile was a dead link that
// bounced app users to an unrelated page. It is gone from the menu; merch is
// still reachable on the web from the footer and direct links.
//
// The last check is the one that would have shipped a visible bug: renderTile
// decided "active" with pathname.startsWith(href), and startsWith("/") is true
// on every page — so a Home tile would have been permanently highlighted, next
// to whichever tile was genuinely active.
check(
  "Store is gone from the M menu, and its icon with it",
  !nav.includes('label: "Store"') &&
    !nav.includes('href: "/store"') &&
    !nav.includes("ShoppingBag"),
);
check(
  "Music holds the freed quick-tile slot and Home is not duplicated there",
  nav.includes('label: "Music",\n      href: "/music",') &&
    !nav.includes('label: "Home",\n      href: "/",'),
);
check(
  "the four quick tiles get four columns, matching the category row below",
  nav.includes('<div className="grid grid-cols-4 gap-2">\n                          {quickLinks.map(renderTile)}'),
);
check(
  "a tile pointing at / is active only ON /, never on every page",
  nav.includes('target === "/" ? pathname === "/" : pathname.startsWith(target)'),
);
check(
  "the transport is scoped to the main page and nowhere else",
  isTransportRoute("/") &&
    isTransportRoute("/?ref=email") &&
    !isTransportRoute("/music") &&
    !isTransportRoute("/store") &&
    !isTransportRoute("/social") &&
    !isTransportRoute("/social/radio") &&
    !isTransportRoute("/social/cinema/room-123") &&
    !isTransportRoute("/studio") &&
    !isTransportRoute("/checkout") &&
    !isTransportRoute("/account") &&
    !isTransportRoute("/photography") &&
    !isTransportRoute("/artists/karl-ray") &&
    !isTransportRoute(null),
);
// THE PILL IS GONE (2026-09-07). Karl: "I think I want to remove the floating
// pill all together... add transport controls right under the spectrum analyzer
// and song progress bar on mobile."
//
// ~900 lines of edge anchoring, pointer-drag, hold-to-grab and position
// persistence existed because the mobile transport had nowhere to live. It has
// somewhere now: inside the HomeHero card, under the waveform and the progress
// bar, as ordinary in-flow content. These checks stop it coming back by
// accident and stop the hero controls being quietly removed.
check(
  "the floating pill is gone, along with its drag and position machinery",
  !player.includes("FloatingPlayer") &&
    !player.includes("floating-player") &&
    !player.includes("player-handle") &&
    !player.includes("melori:player:pos"),
);
check(
  "AudioPlayer renders the desktop bar and nothing else",
  player.includes("return <DesktopBar />;"),
);
check(
  "the hero carries the transport the pill used to: prev, play, next",
  hero.includes('data-testid="hero-prev"') &&
    hero.includes('data-testid="hero-play"') &&
    hero.includes('data-testid="hero-next"'),
);
check(
  "the hero progress bar is seekable, not decoration",
  hero.includes('data-testid="hero-seek"') && hero.includes("seek(value)"),
);
// Every hero control must opt out of the page-wide first-interaction unmute, or
// that handler and the button's own onClick run against different renders of the
// same state and can disagree — start here, pause there.
check(
  "every hero transport control is marked data-hero-audio-control",
  (hero.match(/data-testid="hero-(prev|play|next|seek)"/g) ?? []).length === 4 &&
    (hero.match(/data-hero-audio-control/g) ?? []).length >= 6,
);
check(
  "AudioPlayer renders nothing unless the transport belongs on screen",
  player.includes('from "@/components/player/useTransportVisible"') &&
    player.includes("const showTransport = useTransportVisible()") &&
    player.includes("if (!showTransport) return null;"),
);
// THE DOOR CASE. "/" is not always the home page: since #365 the proxy REWRITES
// "/" to the signup form for anyone without a session, and usePathname() still
// reports "/". The route test alone therefore drew a playback bar and a
// draggable pill on top of the signup form for every stranger who reached the
// site — with a track title read out of localStorage. Verified on production,
// signed out, 2026-09-07.
//
// These pin that the fix cannot be undone by "simplifying" the hook back to a
// route check, and that the two callers keep asking the SAME question: if
// AudioPlayer hides the bar while MainContent still reserves its space, the
// signup form gets a strip of dead air under it instead.
check(
  "the transport is members-only, not merely route-scoped",
  transportVisible.includes('from "@/lib/authStorageKey"') &&
    transportVisible.includes("hasSessionCookie(document.cookie)") &&
    transportVisible.includes("return onTransportRoute && signedIn;"),
);
check(
  "the bar and the space reserved for it are decided by one shared hook",
  player.includes("useTransportVisible()") &&
    mainContent.includes("useTransportVisible()") &&
    !mainContent.includes("isTransportRoute("),
);
check(
  "root content clearance is route-aware, not a global transport reserve",
  layout.includes("<MainContent>{children}</MainContent>") &&
    !layout.includes("pb-[var(--mobile-content-clearance)]"),
);
// With no pill, a phone has nothing fixed to clear but the tab bar — on every
// route, "/" included. Only the DESKTOP half is still route-aware, because the
// desktop bottom bar is real and fixed.
check(
  "mobile clears only the tab bar now; desktop still clears its transport bar",
  mainContent.includes("pb-[var(--mobile-tabbar-clearance)] md:pb-24") &&
    mainContent.includes("pb-[var(--mobile-tabbar-clearance)] md:pb-8") &&
    // The class, not the name: the doc comment above it legitimately explains
    // what the variable used to be for, and should keep doing so.
    !mainContent.includes("pb-[var(--mobile-content-clearance)]"),
);
// The variable survives for --mirror-bottom alone. Mirror has been reserving
// 4.5rem for a transport that was never on that route; reclaiming it is its own
// change. This pins that MainContent is not a consumer any more.
check(
  "--mobile-content-clearance is kept only for Mirror's bottom inset",
  globals.includes("--mobile-content-clearance: calc(var(--mobile-tabbar-clearance) + 4rem + 0.5rem)") &&
    globals.includes("--mirror-bottom: var(--mobile-content-clearance)"),
);
check(
  "Mirror height uses dynamic viewport and shared bottom clearance",
  globals.includes("height: calc(100dvh - var(--mirror-top) - var(--mirror-bottom))"),
);
check(
  "native Mirror uploads render in a 9:16 stage without crop",
  video.includes('className="relative aspect-[9/16] h-full max-w-full"') &&
    video.includes("object-contain object-center"),
);
// Superseded 2026-09-06. This first asserted the YouTube stage was always
// `aspect-video max-h-full w-full`, a contract written when the only YouTube
// post was a landscape music video. Inside a ~9:16 card that fixed 16:9 box
// cost a portrait post its height twice (the box took card-width x 9/16, then
// the player pillarboxed the 9:16 source inside it), so a 1080x1920 episode
// landed on roughly a tenth of the card at any size.
//
// The stage is now chosen from the post's own orientation (migration 075).
// The ORIGINAL intent -- never crop a landscape post -- is preserved: a 16:9
// post still fills the card and lets the player letterbox to card-width x 9/16,
// exactly the box it always had.
check(
  "YouTube Mirror cards pick their stage from the post's own orientation",
  video.includes("video.is_vertical") &&
    video.includes('? "relative aspect-[9/16] h-full max-w-full"') &&
    video.includes(': "relative h-full w-full"') &&
    !video.includes('className="relative aspect-video max-h-full w-full"'),
);
check(
  "Cinema hides mobile navigation only for an actual room id",
  isCinemaLiveRoomRoute("/social/cinema/room-123") &&
    isCinemaLiveRoomRoute("/social/cinema/00000000-0000-4000-8000-000000000101") &&
    !isCinemaLiveRoomRoute("/social/cinema") &&
    !isCinemaLiveRoomRoute("/social/cinema/create") &&
    !isCinemaLiveRoomRoute("/social/cinema/create/") &&
    !isCinemaLiveRoomRoute("/social/cinema/room-123/extra"),
);
check(
  "Cinema mobile navigation uses the dedicated room-route predicate",
  nav.includes("isCinemaLiveRoomRoute(pathname)") &&
    !nav.includes('^\\/social\\/cinema\\/[^/]+/.test(pathname)'),
);

console.log(failures ? `\n${failures} failure(s)\n` : "\nAll mobile layout contracts passed.\n");
process.exit(failures ? 1 : 0);
