/* eslint-disable no-console */
// scripts/android-beta.test.ts
//
// Pins the Android beta-tester flow: /android -> POST /api/android-beta ->
// /admin/android-testers -> invite email.
//
// Google Play closed testing for org.melorimusic.app uses an email list. The
// invite email is the whole product here: if either link drifts, testers land
// on "not found" and the beta stalls exactly the way the Google Group did.
//
// Run:  npx tsx scripts/android-beta.test.ts

import fs from "node:fs";
import path from "node:path";
import {
  ANDROID_APP_ID,
  BANNER_DISMISS_KEY,
  MELORI_SENDER_ADDRESS,
  PLAY_INSTALL_URL,
  PLAY_TESTING_URL,
  adminNotifyEmail,
  confirmationEmail,
  countByStatus,
  inviteEmail,
  isAndroidWebUserAgent,
  isGmail,
  isIPhoneUserAgent,
  mergeSignup,
  pendingEmailsForPlayConsole,
  sanitizeSource,
  shouldShowAndroidBetaBanner,
  validateAndroidBetaSignup,
  type ExistingSignup,
} from "@/lib/androidBeta";
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

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

// ---------------------------------------------------------------------------
console.log("\nValidation");

const good = validateAndroidBetaSignup({
  email: "  Tester@Gmail.com ",
  name: " Ada ",
  country: "Nigeria",
  has_android: true,
  source: "Banner",
});
check("valid signup passes", good.ok);
if (good.ok) {
  check("email is trimmed and lower-cased", good.value.email === "tester@gmail.com");
  check("name is trimmed", good.value.name === "Ada");
  check("country kept", good.value.country === "Nigeria");
  check("source sanitized to a slug", good.value.source === "banner");
}
check("missing email rejected", !validateAndroidBetaSignup({ has_android: true }).ok);
check("malformed email rejected", !validateAndroidBetaSignup({ email: "nope@", has_android: true }).ok);
check("android checkbox is required", !validateAndroidBetaSignup({ email: "a@gmail.com" }).ok);
check(
  "android checkbox must be literally true",
  !validateAndroidBetaSignup({ email: "a@gmail.com", has_android: "true" }).ok,
);
check("non-object body rejected", !validateAndroidBetaSignup(null).ok);

const nonGmail = validateAndroidBetaSignup({ email: "me@company.ng", has_android: true });
check("non-Gmail address is still accepted", nonGmail.ok);
check("isGmail: gmail.com", isGmail("x@gmail.com"));
check("isGmail: googlemail.com", isGmail("x@GoogleMail.com"));
check("isGmail: other domain is not", !isGmail("x@yahoo.com"));

const other = validateAndroidBetaSignup({
  email: "a@gmail.com",
  has_android: true,
  country: "Other",
  country_other: " Ghana ",
});
check("Other + typed country stores the typed country", other.ok && other.value.country === "Ghana");
const otherBlank = validateAndroidBetaSignup({ email: "a@gmail.com", has_android: true, country: "Other" });
check("Other with nothing typed stores 'Other'", otherBlank.ok && otherBlank.value.country === "Other");
const bogusCountry = validateAndroidBetaSignup({ email: "a@gmail.com", has_android: true, country: "<script>" });
check("unknown country value is dropped", bogusCountry.ok && bogusCountry.value.country === null);
const htmlName = validateAndroidBetaSignup({ email: "a@gmail.com", has_android: true, name: "<b>Bo</b>" });
check("angle brackets stripped from name", htmlName.ok && htmlName.value.name === "bBo/b");
check("source strips everything but slug chars", sanitizeSource("ig story!<x>") === "igstoryx");
check("empty source is null", sanitizeSource("") === null);

// ---------------------------------------------------------------------------
console.log("\nIdempotent upsert (mergeSignup)");

const input = { email: "a@gmail.com", name: "Ada", country: "Nigeria", source: "banner" };
const fresh = mergeSignup(null, input, "user-1");
check("new email -> pending", fresh.status === "pending");
check("new email links the signed-in user", fresh.user_id === "user-1");

const existing = (over: Partial<ExistingSignup>): ExistingSignup => ({
  id: "row-1",
  email: "a@gmail.com",
  name: "Ada",
  country: "Nigeria",
  user_id: null,
  status: "pending",
  source: "banner",
  ...over,
});

const again = mergeSignup(existing({}), input, null);
check(
  "same submission twice writes the same row",
  JSON.stringify(again) === JSON.stringify(mergeSignup(existing(again), input, null)),
);
const blank = mergeSignup(existing({}), { email: "a@gmail.com", name: null, country: null, source: null }, null);
check("repeat never blanks name/country/source", blank.name === "Ada" && blank.country === "Nigeria" && blank.source === "banner");
check("repeat keeps the first source", mergeSignup(existing({}), { ...input, source: "email" }, null).source === "banner");
check("repeat fills user_id when signed in later", mergeSignup(existing({}), input, "user-2").user_id === "user-2");
check(
  "repeat never re-points an existing user_id",
  mergeSignup(existing({ user_id: "user-1" }), input, "user-2").user_id === "user-1",
);
check("invited tester is not pushed back to pending", mergeSignup(existing({ status: "invited" }), input, null).status === "invited");
check("added tester is not pushed back to pending", mergeSignup(existing({ status: "added" }), input, null).status === "added");
check("removed tester who asks again returns to pending", mergeSignup(existing({ status: "removed" }), input, null).status === "pending");

// ---------------------------------------------------------------------------
console.log("\nAdmin helpers");

const rows = [
  { email: "a@gmail.com", status: "pending" as const },
  { email: "B@gmail.com", status: "pending" as const },
  { email: "a@gmail.com", status: "pending" as const },
  { email: "c@gmail.com", status: "invited" as const },
  { email: "d@gmail.com", status: "removed" as const },
];
check("copy = pending only, deduped, comma-separated", pendingEmailsForPlayConsole(rows) === "a@gmail.com, b@gmail.com");
const counts = countByStatus(rows);
check("counts by status", counts.pending === 3 && counts.invited === 1 && counts.removed === 1 && counts.added === 0);

// ---------------------------------------------------------------------------
console.log("\nInvite email");

check("testing link is exact", PLAY_TESTING_URL === "https://play.google.com/apps/testing/org.melorimusic.app");
check("install link is exact", PLAY_INSTALL_URL === "https://play.google.com/store/apps/details?id=org.melorimusic.app");
check("app id", ANDROID_APP_ID === "org.melorimusic.app");

const invite = inviteEmail({ name: "Ada", email: "a@gmail.com" });
check("subject", invite.subject === "Your Melori Android invite");
for (const [label, body] of [["html", invite.html], ["text", invite.text]] as const) {
  check(`${label} contains the exact testing link`, body.includes("https://play.google.com/apps/testing/org.melorimusic.app"));
  check(`${label} contains the exact install link`, body.includes("https://play.google.com/store/apps/details?id=org.melorimusic.app"));
  check(`${label} says use the same Google account`, body.includes("same Google account as your Play Store"));
  check(`${label} says wait 15 minutes`, body.includes("wait 15 minutes"));
}
check("text has exactly two numbered steps", /1\) Become a tester/.test(invite.text) && /2\) Install/.test(invite.text) && !/3\)/.test(invite.text));
check("step 1 comes before step 2", invite.text.indexOf(PLAY_TESTING_URL) < invite.text.indexOf(PLAY_INSTALL_URL));
const evil = inviteEmail({ name: "<img src=x>", email: "a@gmail.com" });
check("name is escaped in the invite html", !evil.html.includes("<img src=x>"));
check("invite does not name a person", !/Karl/i.test(invite.html + invite.text));

const confirm = confirmationEmail({ name: null, email: "a@gmail.com" });
check("confirmation names the sender address", confirm.text.includes(MELORI_SENDER_ADDRESS));
check("confirmation does not name a person", !/Karl/i.test(confirm.html + confirm.text));
const notify = adminNotifyEmail({ email: "a@gmail.com", name: "<x>", country: null, source: null, isNew: true });
check("admin notify escapes fields", !notify.html.includes("<x>"));

const emailLib = read("src/lib/email.ts");
check("sender shown to testers matches MELORI_FROM", emailLib.includes(`<${MELORI_SENDER_ADDRESS}>`));

// ---------------------------------------------------------------------------
console.log("\nBanner targeting");

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const ANDROID_APP = `${ANDROID_CHROME} MeloriApp`;
const ANDROID_APP_ID_UA = `${ANDROID_CHROME} org.melorimusic.app`;
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const show = (ua: string, pathname = "/", dismissed = false, nativeApp = false) =>
  shouldShowAndroidBetaBanner({ userAgent: ua, pathname, dismissed, nativeApp });

check("Android Chrome sees the banner", show(ANDROID_CHROME));
check("Android native app (MeloriApp) does not", !show(ANDROID_APP));
check("Android native app (app id UA) does not", !show(ANDROID_APP_ID_UA));
check("Capacitor flag hides it even with a plain UA", !show(ANDROID_CHROME, "/", false, true));
check("iPhone does not", !show(IPHONE));
check("desktop does not", !show(DESKTOP));
check("empty UA does not", !show(""));
check("not on /android itself", !show(ANDROID_CHROME, "/android"));
check("not on /admin", !show(ANDROID_CHROME, "/admin/dashboard"));
check("shows on other pages", show(ANDROID_CHROME, "/music"));
check("dismissed hides it", !show(ANDROID_CHROME, "/", true));
check("isAndroidWebUserAgent agrees", isAndroidWebUserAgent(ANDROID_CHROME) && !isAndroidWebUserAgent(ANDROID_APP));
check("iPhone detection for the /android note", isIPhoneUserAgent(IPHONE) && !isIPhoneUserAgent(ANDROID_CHROME));

const banner = read("src/components/android/AndroidBetaBanner.tsx");
check("banner links to /android?src=banner", banner.includes('href="/android?src=banner"'));
check("banner reads dismissal inside try/catch", /try\s*\{\s*dismissed = window\.localStorage\.getItem\(BANNER_DISMISS_KEY\)/.test(banner));
check("banner writes dismissal inside try/catch", /try\s*\{\s*window\.localStorage\.setItem\(BANNER_DISMISS_KEY/.test(banner));
check("banner uses the shared targeting helper", banner.includes("shouldShowAndroidBetaBanner("));
check("banner dismiss key is namespaced", BANNER_DISMISS_KEY.startsWith("melori."));
const layout = read("src/app/layout.tsx");
check("banner is mounted in the root layout", layout.includes("<AndroidBetaBanner />"));

// ---------------------------------------------------------------------------
console.log("\nPublic access");

check("/android is on the signup-wall allowlist", isPublicPath("/android"));
check("/android/x is not", !isPublicPath("/android/x"));
const api = read("src/app/api/android-beta/route.ts");
check("signup API does not require sign-in", !/requireAuth\(|requireAdmin\(/.test(api));
check("signup API rate-limits per IP", api.includes("rateLimit(") && api.includes("clientIp(req)"));
check("signup API writes with the service role", api.includes("getSupabaseAdmin()"));
const adminApi = read("src/app/api/admin/android-testers/route.ts");
check("admin API is behind requireAdmin", (adminApi.match(/requireAdmin\(req\)/g) ?? []).length >= 2);
check("admin invite sends the shared inviteEmail", adminApi.includes("inviteEmail("));
const page = read("src/app/android/page.tsx");
check("/android page does not force dynamic rendering", !page.includes("force-dynamic"));
check("/android page names no person", !/Karl/i.test(page + read("src/components/android/AndroidBetaForm.tsx")));
check("sitemap lists /android", read("src/app/sitemap.ts").includes("/android`"));

// ---------------------------------------------------------------------------
console.log("\nMigration 097");

const sql = read("supabase/migrations/097_android_beta_signups.sql").toLowerCase();
const code = sql.replace(/--.*$/gm, "");
check("creates public.android_beta_signups", code.includes("create table if not exists public.android_beta_signups"));
check("enables RLS", code.includes("alter table public.android_beta_signups enable row level security"));
check("defines NO policies (service role only)", !/create\s+policy/.test(code));
check("grants nothing to clients", !/\bgrant\b/.test(code));
check("revokes default client grants", code.includes("revoke all on table public.android_beta_signups from anon, authenticated"));
check("email is unique", /unique\s*\(email\)/.test(code));
check("email must be lower-case", code.includes("email = lower(email)"));
check("status check lists the four states", code.includes("'pending', 'added', 'invited', 'removed'"));
check("user_id on delete set null", code.includes("references auth.users(id) on delete set null"));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
