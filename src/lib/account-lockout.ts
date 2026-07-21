import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Account lockout — hard login block for lapsed paid subscribers.
//
// When a subscription is finally dead (Stripe has EXHAUSTED its dunning retries
// and moved the subscription to canceled / unpaid / incomplete_expired), we ban
// the Supabase auth user so they cannot sign in at all — not merely a role
// downgrade. This is deliberately stricter than the tier-gate (`requireArtist`
// etc.) revocation, per product decision for the Snappd photography membership.
//
// IMPORTANT — grace window: we do NOT ban on `past_due`. Stripe keeps retrying
// a failed renewal for its dunning window; during that time membership_status
// is `past_due` and access is preserved. The ban only happens once Stripe gives
// up and cancels, so a temporary card glitch never locks anyone out.
//
// Auto-reactivation: when a successful payment/renewal later lands (subscription
// active again / invoice.paid), we UNBAN the user so their login is restored
// with no manual intervention.
//
// In Supabase, `profiles.id` is the same UUID as the auth user id (the members
// webhook resolves email -> auth user -> profile by that shared id), so the
// profile id can be passed straight to auth.admin.updateUserById.
//
// Uses the service-role admin client (bypasses RLS + can call the auth admin
// API). NEVER import into a client component.
// ---------------------------------------------------------------------------

// A "forever" ban. Supabase expects a Go duration string; there is no literal
// "permanent" value, so we use a very large duration (~100 years). Unban is an
// explicit action (ban_duration: "none"), so this is fully reversible.
const LOCKOUT_DURATION = "876000h"; // ~100 years

export interface LockoutResult {
  ok: boolean;
  changed: boolean;
  error?: string;
}

// Ban (block login for) an auth user. Idempotent and non-fatal: a failure here
// must never crash the Stripe webhook (which would trigger a retry storm), so
// callers should treat a false `ok` as "log and continue".
export async function banAuthUser(
  userId: string,
  client?: SupabaseClient,
): Promise<LockoutResult> {
  if (!userId) return { ok: false, changed: false, error: "Missing user id" };
  const supabase = client ?? getSupabaseAdmin();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.auth.admin as any).updateUserById(userId, {
      ban_duration: LOCKOUT_DURATION,
    });
    if (error) {
      console.error("account-lockout ban error", userId, error.message);
      return { ok: false, changed: false, error: error.message };
    }
    return { ok: true, changed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ban failed";
    console.error("account-lockout ban exception", userId, msg);
    return { ok: false, changed: false, error: msg };
  }
}

// Unban (restore login for) an auth user. `ban_duration: "none"` clears any
// active ban and is a safe no-op when the user isn't banned. Idempotent and
// non-fatal for the same reasons as banAuthUser.
export async function unbanAuthUser(
  userId: string,
  client?: SupabaseClient,
): Promise<LockoutResult> {
  if (!userId) return { ok: false, changed: false, error: "Missing user id" };
  const supabase = client ?? getSupabaseAdmin();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.auth.admin as any).updateUserById(userId, {
      ban_duration: "none",
    });
    if (error) {
      console.error("account-lockout unban error", userId, error.message);
      return { ok: false, changed: false, error: error.message };
    }
    return { ok: true, changed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unban failed";
    console.error("account-lockout unban exception", userId, msg);
    return { ok: false, changed: false, error: msg };
  }
}
