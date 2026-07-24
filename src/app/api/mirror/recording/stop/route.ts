import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { stopRoomRecording } from "@/lib/livekitServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mirror/recording/stop
// Host-only. Stops the in-progress recording for a live space and returns the
// recording's public URL so the client can offer "Post this LIVE to the Mirror?"
//
// Body: { spaceId: string }
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
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
    .select("id, host_id, recording_egress_id, recording_url, recording_storage_key")
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

  return NextResponse.json({
    ok: true,
    // The MP4 finalizes asynchronously in storage; the URL is deterministic and
    // becomes reachable shortly after egress completes.
    recordingUrl: space.recording_url ?? null,
    storageKey: space.recording_storage_key ?? null,
  });
}
