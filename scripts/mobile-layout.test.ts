/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";

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
check(
  "root content uses the shared mobile transport clearance",
  layout.includes("pb-[var(--mobile-content-clearance)] md:pb-24"),
);
check(
  "mobile clearance includes both tab bar and floating transport",
  globals.includes("--mobile-content-clearance: calc(var(--mobile-tabbar-clearance) + 4rem + 0.5rem)"),
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
check(
  "YouTube Mirror cards remain 16:9 and contained",
  video.includes('className="relative aspect-video max-h-full w-full"'),
);

console.log(failures ? `\n${failures} failure(s)\n` : "\nAll mobile layout contracts passed.\n");
process.exit(failures ? 1 : 0);
