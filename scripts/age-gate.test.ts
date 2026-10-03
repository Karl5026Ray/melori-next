/* eslint-disable no-console */
// scripts/age-gate.test.ts
//
// Pins WHO IS OLD ENOUGH.
//
// Owner decisions: Melori Connect (dating) is 18+ only; the platform minimum
// age is 16. Before this, /api/social/connect/profile accepted any birthdate
// and only clamped the age_min/age_max *preferences* to 18 — nothing stopped
// an under-18 member from creating a dating profile or being shown in
// discover.
//
// Two layers are pinned here, both pure (no DB, no network, no token):
//   • ageOn / birthdateCutoff (src/lib/age.ts) — the arithmetic, including
//     the days people get wrong: birthday today, the day before, Feb 29.
//   • decideConnectBirthdate (src/lib/connectAgeGate.ts) — the exact decision
//     the Connect profile PUT route makes before it writes anything. The
//     route itself needs a Superfan bearer token and a live Supabase, so the
//     decision function is what's tested; the route returns its status/code
//     verbatim via connectAgeResponse.
//
// Run:  npx tsx scripts/age-gate.test.ts

import {
  CONNECT_MIN_AGE,
  PLATFORM_MIN_AGE,
  ageOn,
  birthdateCutoff,
  isAtLeast,
  parseIsoDate,
} from "@/lib/age";
import {
  CONNECT_UNDER_AGE_MESSAGE,
  decideConnectBirthdate,
  isConnectEligible,
} from "@/lib/connectAgeGate";

let checks = 0;
let failures = 0;
const ok = (label: string) => { checks += 1; console.log(`  ok    ${label}`); };
const bad = (label: string) => { checks += 1; failures += 1; console.log(`  FAIL  ${label}`); };
const eq = (label: string, got: unknown, want: unknown) =>
  Object.is(got, want) ? ok(label) : bad(`${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

// ---------------------------------------------------------------------------
console.log("constants");
eq("Connect minimum is 18", CONNECT_MIN_AGE, 18);
eq("platform minimum is 16", PLATFORM_MIN_AGE, 16);

// ---------------------------------------------------------------------------
console.log("ageOn: birthdays");
eq("18th birthday today → 18", ageOn("2008-10-02", at("2026-10-02")), 18);
eq("day before 18th birthday → 17", ageOn("2008-10-03", at("2026-10-02")), 17);
eq("day after 18th birthday → 18", ageOn("2008-10-01", at("2026-10-02")), 18);
eq("born today → 0", ageOn("2026-10-02", at("2026-10-02")), 0);
eq("Jan 1 vs Dec 31", ageOn("2000-12-31", at("2018-01-01")), 17);
eq("UTC day boundary: 23:59Z still the 1st", ageOn("2008-10-02", new Date("2026-10-01T23:59:59Z")), 17);

console.log("ageOn: Feb 29");
eq("Feb 29 birth, Feb 28 non-leap year → not yet 18", ageOn("2008-02-29", at("2026-02-28")), 17);
eq("Feb 29 birth, Mar 1 non-leap year → 18", ageOn("2008-02-29", at("2026-03-01")), 18);
eq("Feb 29 birth, Feb 29 leap year → birthday", ageOn("2008-02-29", at("2032-02-29")), 24);
eq("Feb 28 birth on leap Feb 29 → already had it", ageOn("2010-02-28", at("2028-02-29")), 18);

console.log("ageOn: invalid input → null");
for (const s of [
  "", "2008", "2008-1-01", "2008-01-1", "08-01-01", "2008/01/01", "01-01-2008",
  "2008-13-01", "2008-00-10", "2008-01-00", "2008-01-32", "2008-04-31",
  "2007-02-29", "1900-02-29", "2008-01-01T00:00:00Z", " 2008-01-01", "2008-01-01 ",
  "abcd-ef-gh", "1899-12-31", "+2008-01-01",
]) {
  eq(`ageOn(${JSON.stringify(s)})`, ageOn(s, at("2026-10-02")), null);
}
eq("non-string → parseIsoDate null", parseIsoDate(20080101 as unknown), null);
eq("invalid Date for now → null", ageOn("2000-01-01", new Date("nope")), null);

console.log("ageOn: future dates → null");
eq("tomorrow", ageOn("2026-10-03", at("2026-10-02")), null);
eq("next year", ageOn("2027-01-01", at("2026-10-02")), null);
eq("far future", ageOn("2999-12-31", at("2026-10-02")), null);

console.log("isAtLeast");
eq("valid 18+", isAtLeast("2000-01-01", 18, at("2026-10-02")), true);
eq("17 is not 18+", isAtLeast("2009-01-01", 18, at("2026-10-02")), false);
eq("16 is platform age", isAtLeast("2010-10-02", PLATFORM_MIN_AGE, at("2026-10-02")), true);
eq("null is never old enough", isAtLeast(null, 18, at("2026-10-02")), false);
eq("garbage is never old enough", isAtLeast("yesterday", 18, at("2026-10-02")), false);

// ---------------------------------------------------------------------------
console.log("birthdateCutoff agrees with ageOn");
eq("plain day", birthdateCutoff(18, at("2026-10-02")), "2008-10-02");
eq("leap day today → Feb 28 eighteen years back", birthdateCutoff(18, at("2028-02-29")), "2010-02-28");
eq("Feb 28 non-leap → Feb 28 (excludes Feb 29 births)", birthdateCutoff(18, at("2026-02-28")), "2008-02-28");
// Exhaustive cross-check over two years of "today" values and a window of
// birthdates around each cutoff: `birthdate <= cutoff` ⇔ ageOn >= 18.
{
  let mismatches = 0;
  const start = Date.UTC(2027, 0, 1);
  for (let day = 0; day < 731; day += 1) {
    const now = new Date(start + day * 86400000 + 43200000);
    const cutoff = birthdateCutoff(18, now);
    const base = Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), 1);
    for (let off = -40; off <= 40; off += 1) {
      const b = new Date(base + off * 86400000).toISOString().slice(0, 10);
      const byCutoff = b <= cutoff;
      const byAge = (ageOn(b, now) ?? -1) >= 18;
      if (byCutoff !== byAge) mismatches += 1;
    }
  }
  eq("cutoff and ageOn never disagree (2027-2028, incl. leap day)", mismatches, 0);
}

// ---------------------------------------------------------------------------
console.log("Connect profile route decision (PUT /api/social/connect/profile)");
const NOW = at("2026-10-02");
const decide = (requested: unknown, stored: string | null, main: string | null) =>
  decideConnectBirthdate({ requested, stored, main, now: NOW });

{
  const d = decide("2010-05-05", null, null);
  if (!d.ok && d.status === 403 && d.code === "connect_under_18" && d.error === CONNECT_UNDER_AGE_MESSAGE) {
    ok("under-18 birthdate on create → 403 connect_under_18 with the owner's message");
  } else bad(`under-18 create: ${JSON.stringify(d)}`);
}
{
  const d = decide("2008-10-03", null, null);
  if (!d.ok && d.status === 403) ok("one day short of 18 → 403");
  else bad(`one day short: ${JSON.stringify(d)}`);
}
{
  const d = decide("2008-10-02", null, null);
  if (d.ok && d.birthdate === "2008-10-02") ok("18 today → allowed, birthdate stored");
  else bad(`18 today: ${JSON.stringify(d)}`);
}
{
  const d = decide(undefined, null, null);
  if (!d.ok && d.status === 403 && d.code === "connect_birthdate_required") ok("no birthdate anywhere → 403 birthdate_required");
  else bad(`missing: ${JSON.stringify(d)}`);
}
{
  const d = decide("", null, null);
  if (!d.ok && d.code === "connect_birthdate_required") ok("empty string treated as missing");
  else bad(`empty: ${JSON.stringify(d)}`);
}
for (const bogus of ["2008-02-30", "not-a-date", "2030-01-01", 19900101, { y: 1990 }]) {
  const d = decide(bogus, null, null);
  if (!d.ok && d.status === 400 && d.code === "connect_birthdate_invalid") ok(`invalid/future ${JSON.stringify(bogus)} → 400`);
  else bad(`invalid ${JSON.stringify(bogus)}: ${JSON.stringify(d)}`);
}
{
  const d = decide(undefined, null, "1990-04-01");
  if (d.ok && d.birthdate === "1990-04-01") ok("first join seeds from main profile birthday when 18+");
  else bad(`seed: ${JSON.stringify(d)}`);
}
{
  const d = decide(undefined, null, "2011-04-01");
  if (!d.ok && d.code === "connect_under_18") ok("first join with under-18 main profile birthday → 403");
  else bad(`seed minor: ${JSON.stringify(d)}`);
}
{
  const d = decide("1990-01-01", null, "2011-04-01");
  if (!d.ok && d.code === "connect_under_18") ok("main profile says minor → typing an adult date into Connect doesn't help");
  else bad(`lie over main: ${JSON.stringify(d)}`);
}
{
  const d = decide(null, "1995-06-15", null);
  if (d.ok && d.birthdate === "1995-06-15") ok("update with stored 18+ birthdate and no body birthdate → allowed");
  else bad(`stored ok: ${JSON.stringify(d)}`);
}
{
  const d = decide("1995-06-15", "1995-06-15", null);
  if (d.ok) ok("re-sending the same stored birthdate is fine");
  else bad(`same: ${JSON.stringify(d)}`);
}
{
  const d = decide("1990-01-01", "2010-01-01", null);
  if (!d.ok && d.status === 403 && d.code === "connect_birthdate_locked") ok("blocked minor can't lower their birthdate → 403 locked");
  else bad(`lock minor: ${JSON.stringify(d)}`);
}
{
  const d = decide("1996-06-15", "1995-06-15", null);
  if (!d.ok && d.code === "connect_birthdate_locked") ok("stored birthdate can't be changed even by an adult");
  else bad(`lock adult: ${JSON.stringify(d)}`);
}
{
  const d = decide(undefined, "2010-01-01", "1990-01-01");
  if (!d.ok && d.code === "connect_under_18") ok("existing under-18 Connect profile can't be re-activated/updated");
  else bad(`existing minor: ${JSON.stringify(d)}`);
}

console.log("candidate eligibility filter");
eq("adult shown", isConnectEligible("1990-01-01", NOW), true);
eq("minor hidden", isConnectEligible("2010-01-01", NOW), false);
eq("no birthdate hidden", isConnectEligible(null, NOW), false);
eq("garbage birthdate hidden", isConnectEligible("0000-00-00", NOW), false);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
