import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import {
  getGoogleOAuthClient,
  GOOGLE_CALENDAR_SCOPES,
  CalendarNotConfiguredError,
} from "@/lib/google-calendar";
import { signCalendarState } from "@/lib/calendar-oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/studio/calendar/connect — requireArtist. Builds the Google OAuth
// consent URL for the caller and returns { url } for the client to redirect
// to. This is a brand-new, separate OAuth flow from Supabase's Google
// sign-in — it never touches that.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  let oauth2Client;
  try {
    oauth2Client = getGoogleOAuthClient();
  } catch (err) {
    if (err instanceof CalendarNotConfiguredError) {
      return NextResponse.json(
        { error: "Calendar not configured" },
        { status: 503 },
      );
    }
    throw err;
  }

  const state = signCalendarState(userId);
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES,
    state,
  });

  return NextResponse.json({ url });
}
