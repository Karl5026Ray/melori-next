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
import { authFetch } from "@/lib/authClient";

async function clearAdminSessionCookie(): Promise<void> {
  try {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
  } catch {
    /* best-effort: the cookie expires on its own */
  }
}

// Explicit sign-out is an unambiguous statement of intent: if this member is
// currently hosting any live MM Space/Faces room, end it the same way the
// "End" button does, so remaining participants get a clean "This room has
// ended" instead of being stranded connected to a room whose host just
// vanished. See src/app/api/social/spaces/end-all-hosted/route.ts.
//
// This MUST run before supabase.auth.signOut() below: the end endpoint needs
// the still-valid bearer token to identify the caller and authorize the end.
// It is best-effort and never allowed to block sign-out — a user must never
// be trapped in a signed-in state because a room teardown errored.
//
// Every sign-out entry point in the app (Header, Settings, reset-password,
// account deletion, and the social AuthProvider) calls signOutThisDevice() or
// signOutAllDevices() below, so hooking it in exactly once here — rather than
// in each caller — is what actually guarantees it always runs.
async function endAnyHostedLiveRooms(): Promise<void> {
  try {
    await authFetch("/api/social/spaces/end-all-hosted", { method: "POST" });
  } catch (err) {
    console.warn("[authSession] end-all-hosted failed during sign-out", err);
  }
}

/** Sign out of this device only. Sessions on other devices stay alive. */
export async function signOutThisDevice(): Promise<void> {
  await endAnyHostedLiveRooms();
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
  await endAnyHostedLiveRooms();
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    /* ignore */
  }
  await clearAdminSessionCookie();
}
