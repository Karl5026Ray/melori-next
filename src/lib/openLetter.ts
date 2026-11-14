// src/lib/openLetter.ts
//
// Pure helpers for the open-letter signature flow (/open-letter,
// /api/open-letter). No Supabase, no Resend, no Next imports, so the same
// module is safe in client components, route handlers and tsx tests.
//
// The letter: "The Citizen Accountability Clause" — Karl's open letter to
// Congress. Signers leave the minimum (first name, city/state, email, an
// optional checkbox and story). Names are never shown publicly; only the count.

export const OPEN_LETTER_SLUG = "citizen-accountability-clause";

/** Where signers go to talk about the letter. /spaces is public (a signed-out
 *  visitor gets the page explaining MM Spaces and how to join). When Karl opens
 *  a standing room for this, put its path here and every link follows. */
export const OPEN_LETTER_ROOM_PATH = "/spaces";

export type OpenLetterSignatureInput = {
  email: string;
  first_name: string;
  city_state: string;
  has_partner_in_process: boolean;
  story: string | null;
  source: string | null;
};

export type ValidationResult =
  | { ok: true; value: OpenLetterSignatureInput }
  | { ok: false; error: string };

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().slice(0, 254);
}

/** Strip control characters and angle brackets, collapse to `max` chars. */
export function cleanText(raw: unknown, max: number): string | null {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, "")
    .trim()
    .slice(0, max);
  return s || null;
}

/** ?src= is free text from a URL; keep it to a short slug. */
export function sanitizeSource(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
  return s || null;
}

export function validateOpenLetterSignature(body: unknown): ValidationResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const first_name = cleanText(b.first_name, 60);
  if (!first_name) return { ok: false, error: "Please enter your first name." };

  const city_state = cleanText(b.city_state, 100);
  if (!city_state || city_state.length < 2) {
    return { ok: false, error: "Please enter your city and state." };
  }

  const email = normalizeEmail(b.email);
  if (!email) return { ok: false, error: "Please enter your email." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email address." };

  return {
    ok: true,
    value: {
      email,
      first_name,
      city_state,
      has_partner_in_process: b.has_partner_in_process === true,
      story: cleanText(b.story, 1000),
      source: sanitizeSource(b.source),
    },
  };
}

export type ExistingSignature = {
  id: string;
  user_id: string | null;
  story: string | null;
  source: string | null;
  has_partner_in_process: boolean;
};

/**
 * Row to write for a submit. A repeat submit with the same email updates the
 * one row: newest name/city win, a story or checkbox once given is kept unless
 * replaced, and the first source and linked account are never overwritten.
 */
export function mergeSignature(
  existing: ExistingSignature | null,
  input: OpenLetterSignatureInput,
  userId: string | null,
  now: string = new Date().toISOString(),
) {
  return {
    letter: OPEN_LETTER_SLUG,
    email: input.email,
    first_name: input.first_name,
    city_state: input.city_state,
    has_partner_in_process: input.has_partner_in_process || (existing?.has_partner_in_process ?? false),
    story: input.story ?? existing?.story ?? null,
    source: existing?.source ?? input.source,
    user_id: existing?.user_id ?? userId,
    updated_at: now,
  };
}

/** "1 person has signed" / "1,204 people have signed". */
export function formatSignatureCount(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const num = safe.toLocaleString("en-US");
  return safe === 1 ? `${num} person has signed` : `${num} people have signed`;
}
