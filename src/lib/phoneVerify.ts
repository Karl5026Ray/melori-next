// Telnyx Verify — phone number normalisation and the two API calls behind it.
//
// WHY TELNYX AND NOT SUPABASE PHONE AUTH
// --------------------------------------
// Supabase's built-in phone login treats the number as a *credential* — you
// sign in with it. Melori's door treats it as a verified *attribute*: you sign
// in with email and password, and the number proves a real person is behind the
// account before they can appear on camera. Those are different things, and
// only the second one is what we want, so the verification runs through our own
// routes against Telnyx Verify rather than through Supabase's provider list
// (which does not include Telnyx anyway).
//
// Not configured is not an error. When the env vars are absent every call
// returns { configured: false } and the routes answer 503, matching the
// convention the Google Calendar routes already use.
//
// CODE BY PHONE CALL UNTIL TEXTING IS APPROVED (Karl, 2026-09-10)
// ---------------------------------------------------------------
// US carriers block business texts from 10-digit numbers until A2P 10DLC
// registration is approved. Voice calls are not text messaging, so 10DLC does
// not apply to them. Telnyx Verify can deliver the same 6-digit code by a
// phone call that reads it out, and the code is checked the same way.
//
//   TELNYX_VERIFY_CHANNEL = "call"  (default) — the code is read out by a call
//   TELNYX_VERIFY_CHANNEL = "sms"             — the code is texted; switch to
//                                               this once 10DLC is approved
//
// The Verify profile in Telnyx must have the matching channel enabled.

const TELNYX_BASE = "https://api.telnyx.com/v2";

/** Country prefixes we will send to at launch. Widen deliberately, not by accident. */
const ALLOWED_PREFIXES = ["+1"];

export type VerifyChannel = "sms" | "call";

export interface TelnyxConfig {
  apiKey: string;
  verifyProfileId: string;
  channel: VerifyChannel;
}

export function getTelnyxConfig(): TelnyxConfig | null {
  const apiKey = process.env.TELNYX_API_KEY;
  const verifyProfileId = process.env.TELNYX_VERIFY_PROFILE_ID;
  if (!apiKey || !verifyProfileId) return null;
  const channel: VerifyChannel =
    (process.env.TELNYX_VERIFY_CHANNEL ?? "").trim().toLowerCase() === "sms" ? "sms" : "call";
  return { apiKey, verifyProfileId, channel };
}

/**
 * Normalise to E.164. A bare 10-digit input is assumed US/Canada, which is the
 * only region enabled at launch.
 *
 * Returns null for anything that cannot be made into a plausible E.164 number —
 * the caller must treat null as "reject", never as "send anyway".
 */
export function toE164(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (!hasPlus && digits.length === 10) return `+1${digits}`;
  if (!hasPlus && digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (hasPlus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * Is this number in a region we are willing to send to? Toll fraud is
 * overwhelmingly routed to expensive international destinations, so an
 * allowlist is the cheapest possible protection and costs nothing while the
 * membership is North American.
 */
export function isAllowedDestination(e164: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => e164.startsWith(prefix));
}

async function telnyx(
  config: TelnyxConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`${TELNYX_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* Telnyx returned no body — status alone decides. */
  }
  return { ok: res.ok, status: res.status, json };
}

/** Send a verification code by the configured channel (phone call or text). */
export async function sendVerification(
  config: TelnyxConfig,
  e164: string,
): Promise<{ sent: boolean; error?: string }> {
  const { ok, status, json } = await telnyx(config, `/verifications/${config.channel}`, {
    phone_number: e164,
    verify_profile_id: config.verifyProfileId,
  });

  if (ok) return { sent: true };

  // Never surface Telnyx's raw error to the client — it can leak account and
  // routing detail. Log it, return something a person can act on.
  const detail = json?.errors?.[0]?.detail ?? json?.errors?.[0]?.title ?? `HTTP ${status}`;
  console.error(`phoneVerify.sendVerification failed for ${e164}: ${detail}`);
  return {
    sent: false,
    error:
      config.channel === "call"
        ? "Could not call that number. Check it and try again."
        : "Could not send a code to that number.",
  };
}

/** Check a code the user typed. */
export async function checkVerification(
  config: TelnyxConfig,
  e164: string,
  code: string,
): Promise<{ verified: boolean; error?: string }> {
  const { ok, status, json } = await telnyx(
    config,
    `/verifications/by_phone_number/${encodeURIComponent(e164)}/actions/verify`,
    { code, verify_profile_id: config.verifyProfileId },
  );

  if (ok && json?.data?.response_code === "accepted") return { verified: true };

  if (!ok) {
    const detail = json?.errors?.[0]?.detail ?? `HTTP ${status}`;
    console.warn(`phoneVerify.checkVerification rejected ${e164}: ${detail}`);
  }
  return { verified: false, error: "That code didn't match. Check it and try again." };
}
