import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { approvedOrigin } from "@/lib/approved-origin";
import {
  getGoogleOAuthClient,
  CalendarNotConfiguredError,
} from "@/lib/google-calendar";
import { verifyCalendarState } from "@/lib/calendar-oauth-state";
import { encryptToken } from "@/lib/calendar-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/studio/calendar/callback — Google redirects here with ?code=&state=
// after the photographer approves the consent screen. No Authorization header
// is available on this hop (browser navigation, not an authFetch call), so
// the caller's identity comes ONLY from the signed `state` param minted by
// /connect. We exchange the code for tokens, upsert calendar_connections,
// and redirect back into Studio.
//
// Redirect target: /studio/booking?calendar=connected|error. Phase 4 added
// /studio/booking, which is now the primary home for the Connect Google
// Calendar card (CalendarConnectCard is still also mounted on
// /studio/services from Phase 3, but the booking page is the more natural
// landing spot now that availability + booking exist).
const REDIRECT_PATH = "/studio/booking";

export async function GET(req: NextRequest) {
  const origin = approvedOrigin(req);
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const googleError = searchParams.get("error");

  const errorRedirect = () =>
    NextResponse.redirect(`${origin}${REDIRECT_PATH}?calendar=error`);

  if (googleError || !code) {
    console.warn("[calendar/callback] Google returned an error or no code", googleError);
    return errorRedirect();
  }

  const photographerId = verifyCalendarState(state);
  if (!photographerId) {
    console.warn("[calendar/callback] invalid or unsigned state param");
    return errorRedirect();
  }

  let oauth2Client;
  try {
    oauth2Client = getGoogleOAuthClient();
  } catch (err) {
    if (err instanceof CalendarNotConfiguredError) {
      console.warn("[calendar/callback] calendar not configured");
      return errorRedirect();
    }
    throw err;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      // Google only returns a refresh_token on the FIRST consent (or when
      // prompt=consent forces re-consent, which /connect always sets) — if
      // it's still missing here, we can't do offline access; bail out
      // cleanly rather than storing a connection that can't be refreshed.
      console.error(
        `[calendar/callback] no refresh_token returned for photographer ${photographerId}`,
      );
      return errorRedirect();
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin.from("calendar_connections").upsert(
      {
        photographer_id: photographerId,
        provider: "google",
        access_token: encryptToken(tokens.access_token ?? null),
        refresh_token: encryptToken(tokens.refresh_token),
        token_expiry: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        calendar_id: "primary",
        scope: tokens.scope ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "photographer_id" },
    );

    if (error) {
      console.error("[calendar/callback] upsert failed", error.message);
      return errorRedirect();
    }
  } catch (err) {
    console.error(
      "[calendar/callback] token exchange failed",
      err instanceof Error ? err.message : err,
    );
    return errorRedirect();
  }

  return NextResponse.redirect(`${origin}${REDIRECT_PATH}?calendar=connected`);
}
