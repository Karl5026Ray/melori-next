import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULTS = {
  timezone: "America/Chicago",
  min_notice_hours: 24,
  max_advance_days: 90,
  slot_interval_minutes: 30,
  buffer_minutes: 0,
};

// GET /api/studio/settings — requireArtist. Returns the caller's booking
// settings, falling back to defaults (no row yet) rather than 404ing so the
// settings form always has something to render.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("photographer_settings")
    .select(
      "timezone, min_notice_hours, max_advance_days, slot_interval_minutes, buffer_minutes, updated_at",
    )
    .eq("photographer_id", userId)
    .maybeSingle();

  if (error) {
    console.error("studio/settings GET failed", error.message);
    return NextResponse.json({ error: "Could not load settings" }, { status: 500 });
  }

  return NextResponse.json({ settings: data ?? { ...DEFAULTS, updated_at: null } });
}

interface SettingsInput {
  timezone?: string;
  minNoticeHours?: number;
  maxAdvanceDays?: number;
  slotIntervalMinutes?: number;
  bufferMinutes?: number;
}

// PUT /api/studio/settings — requireArtist. Upserts the caller's booking
// settings row.
export async function PUT(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  let body: SettingsInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const timezone =
    typeof body.timezone === "string" && body.timezone.trim()
      ? body.timezone.trim()
      : DEFAULTS.timezone;
  const minNoticeHours =
    Number.isInteger(body.minNoticeHours) && (body.minNoticeHours as number) >= 0
      ? (body.minNoticeHours as number)
      : DEFAULTS.min_notice_hours;
  const maxAdvanceDays =
    Number.isInteger(body.maxAdvanceDays) && (body.maxAdvanceDays as number) > 0
      ? (body.maxAdvanceDays as number)
      : DEFAULTS.max_advance_days;
  const slotIntervalMinutes =
    Number.isInteger(body.slotIntervalMinutes) &&
    (body.slotIntervalMinutes as number) > 0
      ? (body.slotIntervalMinutes as number)
      : DEFAULTS.slot_interval_minutes;
  const bufferMinutes =
    Number.isInteger(body.bufferMinutes) && (body.bufferMinutes as number) >= 0
      ? (body.bufferMinutes as number)
      : DEFAULTS.buffer_minutes;

  // Sanity-check the timezone string against the runtime's IANA database
  // rather than trusting arbitrary client input.
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: updated, error } = await supabase
    .from("photographer_settings")
    .upsert(
      {
        photographer_id: userId,
        timezone,
        min_notice_hours: minNoticeHours,
        max_advance_days: maxAdvanceDays,
        slot_interval_minutes: slotIntervalMinutes,
        buffer_minutes: bufferMinutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "photographer_id" },
    )
    .select(
      "timezone, min_notice_hours, max_advance_days, slot_interval_minutes, buffer_minutes, updated_at",
    )
    .single();

  if (error || !updated) {
    console.error("studio/settings PUT failed", error?.message);
    return NextResponse.json({ error: "Could not save settings" }, { status: 500 });
  }

  return NextResponse.json({ settings: updated });
}
