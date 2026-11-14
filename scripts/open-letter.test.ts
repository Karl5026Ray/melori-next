/* eslint-disable no-console */
// scripts/open-letter.test.ts
//
// Pins the open-letter signature flow: /open-letter -> POST /api/open-letter.
//
// Signers often have a partner in an open immigration case. The contracts that
// matter: the table is service-role only, GET never returns more than a count,
// the page is public, and the public page never carries Karl's private details.
//
// Run:  npx tsx scripts/open-letter.test.ts

import fs from "node:fs";
import path from "node:path";
import {
  OPEN_LETTER_ROOM_PATH,
  OPEN_LETTER_SLUG,
  formatSignatureCount,
  mergeSignature,
  validateOpenLetterSignature,
} from "../src/lib/openLetter";

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

const good = validateOpenLetterSignature({
  first_name: " Ada ",
  city_state: " Chicago, IL ",
  email: "  Ada@Example.COM ",
  has_partner_in_process: true,
  story: "  We have waited <b>two</b> years. ",
  source: "Facebook Post!",
});
check("valid submission passes", good.ok);
if (good.ok) {
  check("email lower-cased and trimmed", good.value.email === "ada@example.com");
  check("name trimmed", good.value.first_name === "Ada");
  check("angle brackets stripped from story", !/[<>]/.test(good.value.story ?? ""));
  check("source slugged", good.value.source === "facebookpost");
  check("checkbox true only for literal true", good.value.has_partner_in_process === true);
}
const truthy = validateOpenLetterSignature({ first_name: "A", city_state: "IL", email: "a@b.co", has_partner_in_process: "yes" });
check("checkbox 'yes' string is not true", truthy.ok && truthy.value.has_partner_in_process === false);
check("missing name rejected", !validateOpenLetterSignature({ city_state: "Chicago", email: "a@b.co" }).ok);
check("missing city rejected", !validateOpenLetterSignature({ first_name: "A", email: "a@b.co" }).ok);
check("bad email rejected", !validateOpenLetterSignature({ first_name: "A", city_state: "Chicago", email: "nope" }).ok);
check("non-object body rejected", !validateOpenLetterSignature(null).ok);

// ---------------------------------------------------------------------------
console.log("\nMerge");

const input = { email: "a@b.co", first_name: "Ada", city_state: "Chicago, IL", has_partner_in_process: false, story: null, source: "ig" };
const fresh = mergeSignature(null, input, "user-1", "2026-11-14T00:00:00Z");
check("new row uses the letter slug", fresh.letter === OPEN_LETTER_SLUG);
check("new row links the signed-in user", fresh.user_id === "user-1");
const again = mergeSignature(
  { id: "x", user_id: "user-1", story: "kept", source: "fb", has_partner_in_process: true },
  input,
  "user-2",
);
check("repeat keeps an earlier story", again.story === "kept");
check("repeat keeps the first source", again.source === "fb");
check("repeat keeps the first linked account", again.user_id === "user-1");
check("repeat never un-ticks the checkbox", again.has_partner_in_process === true);

// ---------------------------------------------------------------------------
console.log("\nCount copy");
check("singular", formatSignatureCount(1) === "1 person has signed");
check("plural with comma", formatSignatureCount(1204) === "1,204 people have signed");
check("junk becomes zero", formatSignatureCount(Number.NaN) === "0 people have signed");

// ---------------------------------------------------------------------------
console.log("\nWiring");

const proxy = read("src/proxy.ts");
check("/open-letter is public in the proxy", /"\/open-letter",/.test(proxy));

const route = read("src/app/api/open-letter/route.ts");
check("route uses the service-role client", route.includes("getSupabaseAdmin"));
check("route never calls requireAuth (public form)", !route.includes("requireAuth"));
check("GET is head-only count", /count:\s*"exact",\s*head:\s*true/.test(route));
check("route has a honeypot", route.includes("body.company"));
check("route is rate limited", route.includes("rateLimit("));
check("response never reveals prior signing (no isNew in JSON)", !/json\(\{\s*ok:\s*true,\s*isNew/.test(route));
check("anonymous repeat cannot overwrite a signature", route.includes("prior.user_id !== userId"));

const page = read("src/app/open-letter/page.tsx");
check("page is static (no force-dynamic)", !page.includes("force-dynamic"));
check("page renders the form", page.includes("<OpenLetterForm"));
for (const secret of ["719 E 103rd", "773-719-8863", "Udochukwu", "Igwe", "Lagos police", "Bolt ride"]) {
  check(`public page omits "${secret}"`, !page.includes(secret));
}

const form = read("src/components/openLetter/OpenLetterForm.tsx");
check("form links to the room path constant", form.includes("OPEN_LETTER_ROOM_PATH"));
check("room path is a site path", OPEN_LETTER_ROOM_PATH.startsWith("/"));

// ---------------------------------------------------------------------------
console.log("\nMigration 103");

const sql = read("supabase/migrations/103_open_letter_signatures.sql").toLowerCase();
const code = sql.replace(/--.*$/gm, "");
check("creates public.open_letter_signatures", code.includes("create table if not exists public.open_letter_signatures"));
check("enables RLS", code.includes("alter table public.open_letter_signatures enable row level security"));
check("defines NO policies (service role only)", !/create\s+policy/.test(code));
check("grants nothing to clients", !/\bgrant\b/.test(code));
check("revokes default client grants", code.includes("revoke all on table public.open_letter_signatures from anon, authenticated"));
check("one signature per email per letter", /unique\s*\(letter,\s*email\)/.test(code));
check("email must be lower-case", code.includes("email = lower(email)"));
check("no partner-name column", !code.includes("partner_name"));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
