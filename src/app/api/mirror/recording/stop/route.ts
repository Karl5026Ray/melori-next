import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { setRoomRecordingFlag, stopRoomRecording } from "@/lib/livekitServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mirror/recording/stop
// Host-only. Stops the in-progress recording for a live space, takes the
// "Recording" banner down for everyone, and lets the client offer "Post this
// LIVE to the Mirror?". The MP4 stays in the PRIVATE recordings bucket — no URL
// is returned because none exists until the host posts it (publish) or it is
// deleted (discard, the "Not now" path).
//
// Body: { spaceId: string }
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  const body = await req.json().catch(() => ({}));
  const spaceId = String(body.spaceId ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: space, error: fetchErr } = await supabase
    .from("spaces")
    .select("id, host_id, livekit_room, recording_egress_id, recording_storage_key")
    .eq("id", spaceId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.host_id !== membership.userId) {
    return NextResponse.json({ error: "Only the host can stop recording" }, { status: 403 });
  }

  // Best-effort stop (no-op if already stopped/missing).
  if (space.recording_egress_id) {
    await stopRoomRecording(space.recording_egress_id);
  }

  await supabase.from("spaces").update({ is_recording: false }).eq("id", spaceId);

  // Clear the banner. Best-effort: the room may already be gone (host ended).
  await setRoomRecordingFlag(space.livekit_room ?? `space_${space.id}`, false).catch(
    (err) => console.warn("[mirror/recording/stop] banner clear failed", (err as Error)?.message)
  );

  return NextResponse.json({
    ok: true,
    hasRecording: !!space.recording_storage_key,
  });
}
