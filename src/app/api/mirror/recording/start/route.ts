import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { recordingConfigured, startRoomRecording } from "@/lib/livekitServer";

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
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
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
  try {
    const rec = await startRoomRecording(roomName);
    const { error: updErr } = await supabase
      .from("spaces")
      .update({
        is_recording: true,
        recording_egress_id: rec.egressId,
        recording_storage_key: rec.storageKey,
        recording_url: rec.publicUrl,
      })
      .eq("id", spaceId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, configured: true, egressId: rec.egressId });
  } catch (err) {
    console.error("[mirror/recording/start] egress failed", (err as Error)?.message);
    return NextResponse.json(
      { error: "Could not start recording. Please try again." },
      { status: 502 }
    );
  }
}
