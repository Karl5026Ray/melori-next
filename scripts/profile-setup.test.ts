/* eslint-disable no-console */
// "Your page" (Karl, 20 Oct 2026): first sign-in lands a blank page on its
// owner's profile once, with a brief translucent welcome by name.
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_LANDING,
  OWN_PROFILE_PATH,
  START_PATH,
  WELCOME_FLAG_KEY,
  WELCOME_VISIBLE_MS,
  isBlankPage,
  startDestination,
  welcomeName,
} from "@/lib/profileSetup";
import { safeNextPath } from "@/lib/mediaSetupMarker";

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
const root = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

console.log("blank page");
assertEq("no photo, no bio is blank", isBlankPage({ avatarUrl: null, bio: "" }), true);
assertEq("whitespace bio is still blank", isBlankPage({ avatarUrl: "", bio: "   " }), true);
assertEq("a photo alone is not blank", isBlankPage({ avatarUrl: "https://x/a.jpg", bio: null }), false);
assertEq("a bio alone is not blank", isBlankPage({ avatarUrl: null, bio: "Producer" }), false);

console.log("where sign-in lands");
assertEq("signed out goes to the catalog", startDestination({ signedIn: false, blank: true, introSeen: false }), DEFAULT_LANDING);
assertEq("a blank page goes to its own page", startDestination({ signedIn: true, blank: true, introSeen: false }), OWN_PROFILE_PATH);
assertEq("only once", startDestination({ signedIn: true, blank: true, introSeen: true }), DEFAULT_LANDING);
assertEq("a set-up page goes to the catalog", startDestination({ signedIn: true, blank: false, introSeen: false }), DEFAULT_LANDING);

console.log("a shared link always wins");
assertEq("no next -> /auth/start", safeNextPath(null, START_PATH), START_PATH);
assertEq("real next is kept", safeNextPath("/social/cinema/abc", START_PATH), "/social/cinema/abc");
assertEq("hostile next falls back to /auth/start", safeNextPath("//evil.example", START_PATH), START_PATH);
assertEq("backslash next falls back to /auth/start", safeNextPath("/\\evil.example", START_PATH), START_PATH);

console.log("welcome");
assertEq("greets by display name", welcomeName({ display_name: "Taliyah Jones", username: "tj" }), "Taliyah Jones");
assertEq("falls back to a real username", welcomeName({ display_name: " ", username: "LonnieP" }), "LonnieP");
assertEq("never shows an auto username", welcomeName({ display_name: null, username: "user_43a30cc3" }), "there");
assertEq("no profile yet", welcomeName(null), "there");
assertEq("brief: a few seconds, not permanent", WELCOME_VISIBLE_MS >= 3000 && WELCOME_VISIBLE_MS <= 10000, true);

console.log("wiring: every sign-in path falls back to /auth/start");
const callback = read("src/app/auth/callback/page.tsx");
const authForm = read("src/components/AuthForm.tsx");
const nativeAuth = read("src/components/NativeAuthListener.tsx");
const register = read("src/app/register/page.tsx");
const door = read("src/app/platform/page.tsx");
assertEq("OAuth / email callback", callback.includes("safeNextPath(next, START_PATH)"), true);
assertEq("email/password form", authForm.includes("safeNextPath(next, START_PATH)"), true);
assertEq("native app deep link", nativeAuth.includes('safeNextPath(params.get("next"), START_PATH)'), true);
assertEq("sign-up page", register.includes('safeNextPath(params.get("next"), START_PATH)'), true);
assertEq("door keeps the shared link, else /auth/start", door.includes('get("next"), START_PATH') && !door.includes("AFTER_SIGNUP"), true);
assertEq("no sign-in path hardcodes /music any more", [callback, authForm, nativeAuth].some((s) => /:\s*"\/music"\)/.test(s)), false);
assertEq("/auth/start exists", fs.existsSync(path.join(root, "src/app/auth/start/page.tsx")), true);
const start = read("src/app/auth/start/page.tsx");
const toast = read("src/components/social/profile/WelcomeToPage.tsx");
const profilePage = read("src/app/social/profile/page.tsx");
assertEq("/auth/start sets the one-shot welcome flag", start.includes("sessionStorage.setItem(WELCOME_FLAG_KEY"), true);
assertEq("the welcome clears the flag so it shows once", toast.includes("sessionStorage.removeItem(WELCOME_FLAG_KEY)"), true);
assertEq("the welcome is translucent", /bg-black\/\d+/.test(toast) && toast.includes("backdrop-blur"), true);
assertEq("the welcome fades on its own", toast.includes("WELCOME_VISIBLE_MS"), true);
assertEq("the welcome is on the member's own page", profilePage.includes("<WelcomeToPage"), true);
assertEq("no permanent site-wide strip", read("src/app/layout.tsx").includes("ProfileSetup"), false);
assertEq("flag key is namespaced", WELCOME_FLAG_KEY.startsWith("melori:"), true);

if (failures > 0) {
  console.error(`\n${failures} failing assertion(s)`);
  process.exit(1);
}
console.log("\nAll profile-setup assertions passed.");
