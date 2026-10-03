// src/lib/age.ts
//
// One place that knows how old someone is.
//
// Owner decisions (Karl, 2026-10):
//   • Melori Connect (dating) is 18+ only.
//   • The platform minimum age is 16 (attested at signup).
//
// Everything here is pure and works on calendar dates in UTC, so the same
// input gives the same answer on the server, in the browser, and in tests.
//
// Birthdays on Feb 29: in a non-leap year the birthday is treated as Mar 1
// (the person has not yet completed the year on Feb 28). This is the
// conservative reading for an age gate, and it is what a plain
// "(month, day) has passed" comparison gives for free.

export const CONNECT_MIN_AGE = 18;
export const PLATFORM_MIN_AGE = 16;

/** Oldest plausible birth year; anything earlier is treated as invalid input. */
const MIN_BIRTH_YEAR = 1900;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export interface CalendarDate {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

/**
 * Strict YYYY-MM-DD parse. Rejects anything else — including ISO timestamps,
 * "2008-2-3", out-of-range months/days, and Feb 29 in non-leap years.
 */
export function parseIsoDate(s: unknown): CalendarDate | null {
  if (typeof s !== "string") return null;
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < MIN_BIRTH_YEAR) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

function todayUtc(now: Date): CalendarDate {
  return { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
}

function cmp(a: CalendarDate, b: CalendarDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

function fmt(c: CalendarDate): string {
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(c.y, 4)}-${p(c.m, 2)}-${p(c.d, 2)}`;
}

/**
 * Whole years completed between `birthdate` (YYYY-MM-DD) and `now` (UTC day).
 * Returns null for malformed, impossible, or future birthdates.
 */
export function ageOn(birthdate: string, now: Date): number | null {
  const b = parseIsoDate(birthdate);
  if (!b) return null;
  if (Number.isNaN(now.getTime())) return null;
  const t = todayUtc(now);
  if (cmp(b, t) > 0) return null; // born in the future
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age -= 1;
  return age;
}

/** True only for a valid birthdate showing at least `minAge` on `now`. */
export function isAtLeast(birthdate: unknown, minAge: number, now: Date): boolean {
  if (typeof birthdate !== "string") return false;
  const age = ageOn(birthdate, now);
  return age !== null && age >= minAge;
}

/**
 * The LATEST birthdate (YYYY-MM-DD) that is at least `minAge` on `now`.
 * Use as a DB filter: `birthdate <= cutoff`. Agrees with ageOn exactly,
 * including Feb 29: on 2028-02-29 the 18+ cutoff is 2010-02-28, and on
 * 2026-02-28 the cutoff is 2008-02-28, so a 2008-02-29 birthday is still out.
 */
export function birthdateCutoff(minAge: number, now: Date): string {
  const t = todayUtc(now);
  const y = t.y - minAge;
  const d = Math.min(t.d, daysInMonth(y, t.m));
  return fmt({ y, m: t.m, d });
}
