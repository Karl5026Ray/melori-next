// src/lib/connectAgeGate.ts
//
// Melori Connect is 18+ only. The SERVER is the gate: every Connect route runs
// through the helpers here, and the client only renders what the server says.
//
// Where the birthdate lives:
//   • dating_profiles.birthdate — the Connect profile's own copy. Once set it
//     is LOCKED: the Connect API will not change it (and migration 086 adds a
//     trigger so a member can't change it through PostgREST either).
//   • profiles.birth_date — the main social profile's birthday. Used to seed a
//     first-time Connect profile, and as a second check: if the main profile
//     says the member is under 18, a different date typed into Connect does
//     not get them in.
//
// The pure functions take no DB handle so scripts/age-gate.test.ts can pin
// them offline.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { CONNECT_MIN_AGE, ageOn, isAtLeast, parseIsoDate } from "@/lib/age";

export const CONNECT_UNDER_AGE_MESSAGE = "Melori Connect is for members 18 and over.";

export type ConnectAgeCode =
  | "connect_under_18"
  | "connect_birthdate_required"
  | "connect_birthdate_invalid"
  | "connect_birthdate_locked";

export type ConnectBirthdateDecision =
  | { ok: true; birthdate: string }
  | { ok: false; status: 400 | 403; code: ConnectAgeCode; error: string };

const deny = (
  status: 400 | 403,
  code: ConnectAgeCode,
  error: string,
): ConnectBirthdateDecision => ({ ok: false, status, code, error });

/**
 * Decide which birthdate a Connect profile write may store, or why it can't
 * proceed. Pure.
 *
 *   requested — `birthdate` from the request body (anything; may be absent)
 *   stored    — dating_profiles.birthdate already on file (null if none)
 *   main      — profiles.birth_date (null if none)
 */
export function decideConnectBirthdate(input: {
  requested: unknown;
  stored: string | null | undefined;
  main: string | null | undefined;
  now: Date;
}): ConnectBirthdateDecision {
  const { requested, now } = input;
  const stored = input.stored || null;
  const main = input.main || null;
  const hasRequested = requested != null && requested !== "";

  if (hasRequested && (typeof requested !== "string" || !parseIsoDate(requested) || ageOn(requested, now) === null)) {
    return deny(400, "connect_birthdate_invalid", "Enter a valid birthdate (YYYY-MM-DD).");
  }

  // A Connect birthdate already on file is locked.
  if (stored) {
    if (hasRequested && requested !== stored) {
      return deny(
        403,
        "connect_birthdate_locked",
        "Your Connect birthdate can't be changed. Contact support if it's wrong.",
      );
    }
    if (!isAtLeast(stored, CONNECT_MIN_AGE, now)) {
      return deny(403, "connect_under_18", CONNECT_UNDER_AGE_MESSAGE);
    }
    return { ok: true, birthdate: stored };
  }

  const candidate = hasRequested ? (requested as string) : main;
  if (!candidate) {
    return deny(
      403,
      "connect_birthdate_required",
      "Add your birthdate to use Melori Connect. Connect is for members 18 and over.",
    );
  }
  if (!isAtLeast(candidate, CONNECT_MIN_AGE, now)) {
    return deny(403, "connect_under_18", CONNECT_UNDER_AGE_MESSAGE);
  }
  // The main profile's birthday is a second witness: if it says under 18 (or
  // is malformed), a different date typed into Connect is not enough.
  if (main && main !== candidate && !isAtLeast(main, CONNECT_MIN_AGE, now)) {
    return deny(403, "connect_under_18", CONNECT_UNDER_AGE_MESSAGE);
  }
  return { ok: true, birthdate: candidate };
}

/** True when a stored dating profile row may be shown to / used by others. */
export function isConnectEligible(birthdate: unknown, now: Date): boolean {
  return isAtLeast(birthdate, CONNECT_MIN_AGE, now);
}

export function connectAgeResponse(
  d: Extract<ConnectBirthdateDecision, { ok: false }>,
): NextResponse {
  return NextResponse.json({ error: d.error, code: d.code }, { status: d.status });
}

/**
 * Server guard for the browsing routes (discover, like, matches,
 * who-liked-you): the CALLER must have a Connect profile with a valid 18+
 * birthdate. Returns null when allowed, a 403 response otherwise, or
 * "no_profile" when the caller has never opted in.
 */
export async function guardConnectCaller(
  supabase: SupabaseClient,
  me: string,
  now: Date,
): Promise<NextResponse | "no_profile" | null> {
  const { data } = await supabase
    .from("dating_profiles")
    .select("birthdate")
    .eq("user_id", me)
    .maybeSingle();
  if (!data) return "no_profile";
  const bd = (data.birthdate as string | null) ?? null;
  if (!bd) {
    return NextResponse.json(
      {
        error: "Add your birthdate to use Melori Connect. Connect is for members 18 and over.",
        code: "connect_birthdate_required" satisfies ConnectAgeCode,
      },
      { status: 403 },
    );
  }
  if (!isConnectEligible(bd, now)) {
    return NextResponse.json(
      { error: CONNECT_UNDER_AGE_MESSAGE, code: "connect_under_18" satisfies ConnectAgeCode },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Of `ids`, the ones whose Connect profile carries a valid 18+ birthdate.
 * Anyone with no dating profile, no birthdate, or an under-18 birthdate is
 * dropped.
 */
export async function filterConnectEligibleIds(
  supabase: SupabaseClient,
  ids: string[],
  now: Date,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids.length === 0) return out;
  const { data } = await supabase
    .from("dating_profiles")
    .select("user_id, birthdate")
    .in("user_id", ids);
  for (const r of data ?? []) {
    if (isConnectEligible(r.birthdate, now)) out.add(r.user_id as string);
  }
  return out;
}
