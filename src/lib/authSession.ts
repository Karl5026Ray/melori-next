// Shared sign-out helpers.
//
// Supabase's `signOut()` defaults to `scope: "global"`, which revokes EVERY
// refresh token the user has on every device. Signing out on the desktop site
// therefore killed the session inside the mobile app (and vice versa), which is
// the main reason "staying logged in" never worked. Ordinary sign-out must be
// `scope: "local"` — it only drops the session in this browser/WebView.
//
// `admin_session` is a separate server-issued HttpOnly cookie (see
// /api/admin/logout). Only the Header used to clear it, so signing out from
// Settings left an admin JWT live until it expired. Every sign-out path now
// goes through here so both credentials are always cleared together.

import { supabase } from "@/lib/supabase";

async function clearAdminSessionCookie(): Promise<void> {
  try {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
  } catch {
    /* best-effort: the cookie expires on its own */
  }
}

/** Sign out of this device only. Sessions on other devices stay alive. */
export async function signOutThisDevice(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* ignore — local state is cleared regardless */
  }
  await clearAdminSessionCookie();
}

/**
 * Sign out everywhere and revoke every refresh token for the account.
 * Only for flows where losing every session is the point: account deletion and
 * password reset.
 */
export async function signOutAllDevices(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    /* ignore */
  }
  await clearAdminSessionCookie();
}
