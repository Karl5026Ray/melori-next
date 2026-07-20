// Server-only Google Calendar helpers — Phase 3 of the photography module.
//
// This is a BRAND NEW, SEPARATE OAuth flow from the existing Supabase Google
// sign-in. It never touches Supabase auth. Tokens live in
// public.calendar_connections (service-role access only), encrypted at rest
// via src/lib/calendar-crypto.ts when CALENDAR_TOKEN_KEY is configured.
//
// Every helper here fails GRACEFULLY (returns null/empty + logs) rather than
// throwing when: the Google env vars aren't configured yet, or the
// photographer hasn't connected a calendar. That lets Phase 4 callers
// (availability engine, booking flow) skip calendar sync cleanly instead of
// crashing the whole booking path.

import { google } from "googleapis";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { encryptToken, decryptToken } from "@/lib/calendar-crypto";

// Use googleapis' own re-exported OAuth2 client type (avoids a duplicate
// `google-auth-library` package mismatch between this app's top-level
// dependency and the nested copy inside googleapis-common).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/** Thrown when GOOGLE_CLIENT_ID/SECRET/OAUTH_REDIRECT aren't set yet. Callers
 * in route handlers should catch this and return a 503 "not configured". */
export class CalendarNotConfiguredError extends Error {
  constructor(message = "Google Calendar is not configured") {
    super(message);
    this.name = "CalendarNotConfiguredError";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new CalendarNotConfiguredError(`${name} is not set`);
  return value;
}

/** True if all required Google OAuth env vars are present. Use this for
 * non-throwing checks (e.g. status endpoint, UI gating). */
export function isCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT,
  );
}

/**
 * Builds a fresh OAuth2 client from env vars. Throws
 * CalendarNotConfiguredError if any required env var is missing — callers
 * must catch this and respond with a clear "not configured" error rather
 * than letting the route crash.
 */
export function getGoogleOAuthClient(): OAuth2Client {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requiredEnv("GOOGLE_OAUTH_REDIRECT");
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

interface CalendarConnectionRow {
  id: string;
  photographer_id: string;
  access_token: string | null;
  refresh_token: string;
  token_expiry: string | null;
  calendar_id: string;
  scope: string | null;
}

async function loadConnection(
  photographerId: string,
): Promise<CalendarConnectionRow | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("calendar_connections")
    .select(
      "id, photographer_id, access_token, refresh_token, token_expiry, calendar_id, scope",
    )
    .eq("photographer_id", photographerId)
    .maybeSingle();
  if (error) {
    console.error("[google-calendar] failed to load connection", error.message);
    return null;
  }
  return (data as CalendarConnectionRow | null) ?? null;
}

/**
 * Loads the photographer's stored refresh token, builds an authenticated
 * OAuth2 client, and auto-refreshes the access token if it's missing/expired
 * — persisting the new access_token + expiry back to the DB. Returns null
 * (logging, never throwing) if Google isn't configured or the photographer
 * hasn't connected a calendar, so callers can skip sync cleanly.
 */
export async function getGoogleClientForPhotographer(
  photographerId: string,
): Promise<{ client: OAuth2Client; calendarId: string } | null> {
  if (!isCalendarConfigured()) {
    console.warn(
      "[google-calendar] not configured (missing GOOGLE_CLIENT_ID/SECRET/OAUTH_REDIRECT) — skipping.",
    );
    return null;
  }

  const connection = await loadConnection(photographerId);
  if (!connection) {
    console.warn(
      `[google-calendar] no calendar connection for photographer ${photographerId} — skipping.`,
    );
    return null;
  }

  let oauth2Client: OAuth2Client;
  try {
    oauth2Client = getGoogleOAuthClient();
  } catch (err) {
    console.warn("[google-calendar] not configured", err);
    return null;
  }

  const refreshToken = decryptToken(connection.refresh_token);
  if (!refreshToken) {
    console.error(
      `[google-calendar] could not decrypt refresh token for photographer ${photographerId}.`,
    );
    return null;
  }

  const accessToken = decryptToken(connection.access_token);
  const expiryMs = connection.token_expiry
    ? new Date(connection.token_expiry).getTime()
    : 0;

  oauth2Client.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken,
    expiry_date: expiryMs || undefined,
  });

  const isExpiredOrMissing = !accessToken || !expiryMs || expiryMs <= Date.now() + 60_000;

  if (isExpiredOrMissing) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      const admin = getSupabaseAdmin();
      await admin
        .from("calendar_connections")
        .update({
          access_token: encryptToken(credentials.access_token ?? null),
          token_expiry: credentials.expiry_date
            ? new Date(credentials.expiry_date).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("photographer_id", photographerId);
    } catch (err) {
      console.error(
        `[google-calendar] failed to refresh access token for photographer ${photographerId}`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  return { client: oauth2Client, calendarId: connection.calendar_id || "primary" };
}

export interface BusyInterval {
  start: string;
  end: string;
}

/**
 * Returns busy intervals [{start,end}] for the photographer's connected
 * calendar between timeMin/timeMax (ISO strings). Returns an empty array
 * (never throws) if not connected/configured or on API failure — Phase 4's
 * availability engine should treat that as "no calendar busy data available".
 */
export async function getBusyIntervals(
  photographerId: string,
  timeMin: string,
  timeMax: string,
): Promise<BusyInterval[]> {
  const conn = await getGoogleClientForPhotographer(photographerId);
  if (!conn) return [];

  try {
    const calendar = google.calendar({ version: "v3", auth: conn.client });
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: conn.calendarId }],
      },
    });
    const busy = res.data.calendars?.[conn.calendarId]?.busy ?? [];
    return busy
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: b.start as string, end: b.end as string }));
  } catch (err) {
    console.error(
      `[google-calendar] getBusyIntervals failed for photographer ${photographerId}`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  attendeeEmail?: string;
}

/**
 * Inserts an event on the photographer's connected Google Calendar. Returns
 * the created event id, or null (logging, never throwing) if not
 * connected/configured or on API failure.
 */
export async function createCalendarEvent(
  photographerId: string,
  input: CreateEventInput,
): Promise<string | null> {
  const conn = await getGoogleClientForPhotographer(photographerId);
  if (!conn) return null;

  try {
    const calendar = google.calendar({ version: "v3", auth: conn.client });
    const res = await calendar.events.insert({
      calendarId: conn.calendarId,
      requestBody: {
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
        attendees: input.attendeeEmail
          ? [{ email: input.attendeeEmail }]
          : undefined,
      },
    });
    return res.data.id ?? null;
  } catch (err) {
    console.error(
      `[google-calendar] createCalendarEvent failed for photographer ${photographerId}`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Deletes an event from the photographer's connected Google Calendar.
 * Returns true on success, false otherwise (logging, never throwing) — safe
 * to call even if the event was already removed or calendar isn't connected.
 */
export async function deleteCalendarEvent(
  photographerId: string,
  eventId: string,
): Promise<boolean> {
  const conn = await getGoogleClientForPhotographer(photographerId);
  if (!conn) return false;

  try {
    const calendar = google.calendar({ version: "v3", auth: conn.client });
    await calendar.events.delete({
      calendarId: conn.calendarId,
      eventId,
    });
    return true;
  } catch (err) {
    console.error(
      `[google-calendar] deleteCalendarEvent failed for photographer ${photographerId}`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
