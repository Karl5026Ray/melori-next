// Single entry point for signing a user out of Melori.
//
// WHY THIS EXISTS
// ---------------
// Two things used to go wrong at every ad-hoc `supabase.auth.signOut()` site:
//
//  1. `signOut()` defaults to `scope: "global"`, which revokes EVERY refresh
//     token the user holds, on every device. Signing out on the desktop site
//     therefore killed the mobile app's session (and vice versa), which is the
//     "I get logged out / my login doesn't stay" report. Ordinary sign-out
//     wants `scope: "local"` — end this session, leave other devices alone.
//
//  2. Only the header menu also cleared the server-side `admin_session` cookie,
//     so an admin who signed out anywhere else kept a live admin JWT until it
//     expired on its own.
//
// Going through here keeps both correct in one place.

import { supabase } from "@/lib/supabase";

export type SignOutScope = "local" | "global";

/**
 * Signs the user out. `scope` defaults to "local" — pass "global" only when
 * revoking the user's other devices is genuinely intended.
 */
export async function signOutUser(scope: SignOutScope = "local"): Promise<void> {
  try {
    await supabase.auth.signOut({ scope });
  } catch {
    /* Never block the UI on a failed revoke: local state is cleared either way. */
  }
  try {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
  } catch {
    /* No-op for non-admins; ignore transport failures. */
  }
}
