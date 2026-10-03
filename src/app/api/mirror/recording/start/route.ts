import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import {
  recordingConfigured,
  setRoomRecordingFlag,
  startRoomRecording,
  stopRoomRecording,
} from "@/lib/livekitServer";
import { startRecordingUpdate } from "@/lib/mirrorRecording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mirror/recording/start
// Host-only. Starts a LiveKit room-composite recording for a live space so the
// session can later be posted to the Melori Mirror as content.
//
// Body: { spaceId: string }
// - Degrades gracefully: if recording isn't configured (no S3 egress creds),
//   returns { ok:false, configured:false } with 200 so the client can tell the
//   host "recording isn't set up" without treating it as an error.
// - CONSENT FIRST (Illinois is all-party consent): before egress begins we set
//   the server-owned `recording` flag in the LiveKit room metadata, which puts
//   a red "Recording" banner in front of EVERY participant immediately and makes
//   late joiners confirm before they connect. If the room can't be told, the
//   recording does not start.
// - The MP4 goes to the PRIVATE recordings bucket. No public URL is stored;
//   the recording only becomes viewable if the host posts it.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  if (!recordingConfigured()) {
    return NextResponse.json({ ok: false, configured: false });
  }

  const body = await req.json().catch(() => ({}));
  const spaceId = String(body.spaceId ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: space, error: fetchErr } = await supabase
    .from("spaces")
    .select("id, host_id, status, livekit_room, is_recording, recording_egress_id")
    .eq("id", spaceId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.host_id !== membership.userId) {
    return NextResponse.json({ error: "Only the host can record this room" }, { status: 403 });
  }
  if (space.status === "ended") {
    return NextResponse.json({ error: "This live has already ended" }, { status: 409 });
  }
  if (space.is_recording && space.recording_egress_id) {
    // Idempotent: already recording.
    return NextResponse.json({ ok: true, configured: true, alreadyRecording: true });
  }

  const roomName = space.livekit_room ?? `space_${space.id}`;

  // 1. Tell the room. Nobody is recorded before the banner is up.
  try {
    await setRoomRecordingFlag(roomName, true);
  } catch (err) {
    console.error("[mirror/recording/start] could not notify room", (err as Error)?.message);
    return NextResponse.json(
      { error: "Could not notify the room, so recording was not started. Please try again." },
      { status: 502 }
    );
  }

  // 2. Start egress into the private bucket.
  let egressId: string | null = null;
  try {
    const rec = await startRoomRecording(roomName);
    egressId = rec.egressId;
    const { error: updErr } = await supabase
      .from("spaces")
      .update(startRecordingUpdate(rec.egressId, rec.storageKey))
      .eq("id", spaceId);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ ok: true, configured: true, egressId: rec.egressId });
  } catch (err) {
    console.error("[mirror/recording/start] egress failed", (err as Error)?.message);
    // Roll back: stop anything that did start and take the banner down, so the
    // room is never told it's recorded when it isn't (or vice versa).
    if (egressId) await stopRoomRecording(egressId);
    await setRoomRecordingFlag(roomName, false).catch(() => undefined);
    return NextResponse.json(
      { error: "Could not start recording. Please try again." },
      { status: 502 }
    );
  }
}
