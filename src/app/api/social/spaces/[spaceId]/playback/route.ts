import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Playback control for an MM Cinema room.
//
// GET  — anyone may read the room's playback state.
// PUT  — ONLY the room's host may write it.
//
// That asymmetry is the entire security model of the shared screen. There is
// deliberately no RLS write policy on room_playback_state (migration 051), so
// this route is the single path to changing what a room is watching. If a
// guest could write, any guest could seize the screen mid-broadcast.

/** Extrapolation epoch for clients: our clock, so they can measure their skew. */
function serverNow() {
  return new Date().toISOString();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("room_playback_state")
    .select("*")
    .eq("space_id", spaceId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A room with no row yet is normal, not an error: the host hasn't picked
  // anything to watch. Return null state plus the clock so the guest can still
  // calibrate before the first source lands.
  return NextResponse.json({ state: data ?? null, server_now: serverNow() });
}

interface PlaybackPatch {
  source_url?: unknown;
  source_type?: unknown;
  position_seconds?: unknown;
  duration_seconds?: unknown;
  is_playing?: unknown;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Host check against the DATABASE, not against anything the client sent.
  // Also confirms the room is a Cinema room and still open — writing playback
  // into an ended room would leave a row that a stale client could act on.
  const { data: space, error: spaceErr } = await supabase
    .from("spaces")
    .select("id, host_id, status, room_format")
    .eq("id", spaceId)
    .maybeSingle();

  if (spaceErr) {
    return NextResponse.json({ error: spaceErr.message }, { status: 500 });
  }
  if (!space) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (space.host_id !== userId) {
    return NextResponse.json(
      { error: "Only the host controls the screen" },
      { status: 403 },
    );
  }
  if (space.room_format !== "cinema") {
    return NextResponse.json(
      { error: "This room is not a Cinema room" },
      { status: 409 },
    );
  }
  if (space.status === "ended") {
    return NextResponse.json({ error: "This room has ended" }, { status: 409 });
  }

  let body: PlaybackPatch;
  try {
    body = (await req.json()) as PlaybackPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Build the patch field by field. Only keys the client actually sent are
  // touched, so a heartbeat that reports position doesn't accidentally clear
  // the source, and a pause doesn't reset duration.
  const patch: Record<string, unknown> = {
    space_id: spaceId,
    updated_by: userId,
  };

  if ("source_url" in body) {
    const url = body.source_url;
    if (url !== null && typeof url !== "string") {
      return NextResponse.json({ error: "source_url must be a string or null" }, { status: 400 });
    }
    if (typeof url === "string" && url && !url.startsWith("https://")) {
      // Mirrors classifySource() on the client. Enforced again here because a
      // client check is a convenience, not a control.
      return NextResponse.json({ error: "source_url must be https" }, { status: 400 });
    }
    patch.source_url = url || null;
  }

  if ("source_type" in body) {
    const type = body.source_type;
    // Mirrors the room_playback_state CHECK constraint from migration 051. A
    // value the database would reject should fail here with a readable message
    // rather than as a 500 from Postgres.
    if (type !== "url" && type !== "youtube") {
      return NextResponse.json(
        { error: "source_type must be 'url' or 'youtube'" },
        { status: 400 },
      );
    }
    patch.source_type = type;
  }

  if ("position_seconds" in body) {
    const pos = Number(body.position_seconds);
    if (!Number.isFinite(pos) || pos < 0) {
      return NextResponse.json(
        { error: "position_seconds must be a non-negative number" },
        { status: 400 },
      );
    }
    patch.position_seconds = pos;
  }

  if ("duration_seconds" in body) {
    const dur = body.duration_seconds;
    if (dur === null) {
      patch.duration_seconds = null;
    } else {
      const n = Number(dur);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: "duration_seconds must be a non-negative number or null" },
          { status: 400 },
        );
      }
      patch.duration_seconds = n;
    }
  }

  if ("is_playing" in body) {
    if (typeof body.is_playing !== "boolean") {
      return NextResponse.json({ error: "is_playing must be a boolean" }, { status: 400 });
    }
    patch.is_playing = body.is_playing;
  }

  // Upsert on space_id: the first control the host touches creates the row.
  // `updated_at` is intentionally NOT set here — the trigger stamps it with the
  // database clock, which is the epoch every guest extrapolates from.
  const { data, error } = await supabase
    .from("room_playback_state")
    .upsert(patch, { onConflict: "space_id" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ state: data, server_now: serverNow() });
}
