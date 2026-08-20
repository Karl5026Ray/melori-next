"use client";

// One-time post-signup camera/microphone setup — the device-local marker.
//
// WHAT THIS IS NOT
// ----------------
// This is NOT a record that the user "has camera permission". Browser media
// grants are per-origin AND per-device (and, in Safari, frequently per-session):
// a grant given in Chrome on a laptop says nothing about the same account in
// Safari on a phone, and the browser can revoke it at any time. Persisting a
// "camera_allowed" column on the profile would therefore be a lie the rest of
// the app would then act on.
//
// So the only thing recorded is "this browser, on this device, has already been
// shown the setup step" — kept in localStorage, never sent to the server, and
// never consulted before calling getUserMedia. Every capture path still asks
// the browser and still handles a denial (see formatCaptureError).

export const MEDIA_SETUP_STORAGE_KEY = "melori.media-setup.v1";

export type MediaSetupOutcome = "granted" | "skipped" | "denied";

export interface MediaSetupRecord {
  outcome: MediaSetupOutcome;
  at: string;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // Private mode / blocked storage: treat as "no marker", which just means
    // the setup step may be offered again. Harmless.
    return null;
  }
}

export function readMediaSetupRecord(): MediaSetupRecord | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(MEDIA_SETUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MediaSetupRecord>;
    if (
      parsed &&
      (parsed.outcome === "granted" ||
        parsed.outcome === "skipped" ||
        parsed.outcome === "denied")
    ) {
      return { outcome: parsed.outcome, at: parsed.at ?? "" };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Has this browser already been through the setup step at all? Any outcome —
 * including a denial or a skip — counts, because the step is one-time by
 * design: nagging on every visit is worse than the user re-enabling the
 * permission from the call screen's guidance when they actually need it.
 */
export function hasSeenMediaSetup(): boolean {
  return readMediaSetupRecord() !== null;
}

export function markMediaSetupSeen(outcome: MediaSetupOutcome): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      MEDIA_SETUP_STORAGE_KEY,
      JSON.stringify({ outcome, at: new Date().toISOString() } satisfies MediaSetupRecord),
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Sentinel origin used only for parsing. Any origin works: the point is that a
 * candidate which resolves to a DIFFERENT origin than this one is, by
 * definition, not a same-origin path.
 */
const REDIRECT_BASE = "https://melori.invalid";

/**
 * Only same-origin absolute paths — this value ends up in a redirect, so it is
 * an open-redirect sink.
 *
 * A `startsWith("/") && !startsWith("//")` prefix check is NOT sufficient.
 * Browsers normalise backslashes to forward slashes in the authority position,
 * so `/\evil.example` and `/\/evil.example` navigate off-origin while passing
 * that check; leading control characters and whitespace are stripped before
 * parsing, so `"/\u0000/evil.example"` and `"\n//evil.example"` do the same.
 *
 * The rule enforced here instead:
 *   1. reject anything containing a backslash, a control character, or
 *      whitespace — no legitimate in-app destination needs them, and every
 *      known normalisation bypass needs at least one;
 *   2. reject encoded backslashes (%5c) for the same reason, since the value
 *      is handed to a router that will decode it;
 *   3. resolve the candidate against a fixed base with the URL parser and
 *      require BOTH that the resulting origin is unchanged AND that the
 *      pathname starts with "/".
 * Query strings and hashes on a same-origin path are preserved.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/music"): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(next)) return fallback;
  if (/%5c/i.test(next)) return fallback;
  if (!next.startsWith("/")) return fallback; // relative, absolute or scheme-ful
  if (next.startsWith("//")) return fallback; // protocol-relative

  let url: URL;
  try {
    url = new URL(next, REDIRECT_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== REDIRECT_BASE) return fallback;
  if (!url.pathname.startsWith("/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

export const MEDIA_SETUP_PATH = "/onboarding/media";

/**
 * Where a freshly signed-up user should go. Pure so signup routing can be
 * asserted without a browser: the setup step is inserted BEFORE the intended
 * destination, and skipped entirely once this device has seen it.
 */
export function postSignupDestination(
  intendedNext: string | null | undefined,
  alreadySeen: boolean,
  fallback = "/music",
): string {
  const next = safeNextPath(intendedNext, fallback);
  if (alreadySeen) return next;
  return `${MEDIA_SETUP_PATH}?next=${encodeURIComponent(next)}`;
}
