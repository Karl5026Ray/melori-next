import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { deriveRoomName } from "@/lib/endRoom";
import {
  recordingConfigured,
  setRoomRecordingFlag,
  startRoomRecording,
  stopRoomRecording,
} from "@/lib/livekitServer";
import { recordingsBucket, startRecordingUpdate } from "@/lib/mirrorRecording";
import { isContextFailure, loadAuditionContext } from "@/lib/auditions.server";
import { canStartRecording, MAX_RECORDINGS_PER_SESSION } from "@/lib/auditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ spaceId: string }> };

const PLAY_URL_TTL_SECONDS = 30 * 60;

// POST /api/auditions/[spaceId]/recording  { action: "start" | "stop" }
//
// Director (host) only. Reuses the Mirror egress pipeline:
//  - CONSENT FIRST: the room's server-owned `recording` flag goes up before
//    egress starts, so every participant sees the red REC banner (Illinois is
//    all-party consent). If the room can't be told, nothing records.
//  - The MP4 goes to the PRIVATE recordings bucket and is never published.
//  - At most MAX_RECORDINGS_PER_SESSION takes; all are deleted when the
//    session ends (see auditionRecordings.server.ts).
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const ctx = await loadAuditionContext((await params).spaceId, guard.membership.userId!);
  if (isContextFailure(ctx)) return ctx;
  if (!ctx.isHost) {
    return NextResponse.json({ error: "Only the director can record" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const supabase = getSupabaseAdmin();
  const { room } = ctx;
  const roomName = deriveRoomName({ id: room.id, livekit_room: room.livekit_room });

  if (body.action === "stop") {
    if (room.recording_egress_id) await stopRoomRecording(room.recording_egress_id);
    const now = new Date().toISOString();
    await Promise.all([
      supabase
        .from("audition_recordings")
        .update({ stopped_at: now })
        .eq("space_id", room.id)
        .is("stopped_at", null),
      supabase
        .from("spaces")
        .update({ is_recording: false, recording_egress_id: null, recording_storage_key: null })
        .eq("id", room.id),
    ]);
    await setRoomRecordingFlag(roomName, false).catch((err) =>
      console.warn("[auditions/recording] banner clear failed", (err as Error)?.message),
    );
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "start") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  if (!recordingConfigured()) {
    return NextResponse.json(
      { error: "Recording isn't set up on Melori yet", configured: false },
      { status: 503 },
    );
  }

  const { count } = await supabase
    .from("audition_recordings")
    .select("id", { count: "exact", head: true })
    .eq("space_id", room.id);
  const decision = canStartRecording({
    roomStatus: room.status,
    isRecording: room.is_recording && Boolean(room.recording_egress_id),
    takesSoFar: count ?? 0,
  });
  if (!decision.ok) {
    if (decision.reason === "already-recording") return NextResponse.json({ ok: true, alreadyRecording: true });
    const msg =
      decision.reason === "limit-reached"
        ? `You've used all ${MAX_RECORDINGS_PER_SESSION} recordings for this session`
        : "This session has ended";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  try {
    await setRoomRecordingFlag(roomName, true);
  } catch (err) {
    console.error("[auditions/recording] could not notify room", (err as Error)?.message);
    return NextResponse.json(
      { error: "Couldn't tell the room it's being recorded, so recording didn't start." },
      { status: 502 },
    );
  }

  let egressId: string | null = null;
  try {
    const rec = await startRoomRecording(roomName);
    egressId = rec.egressId;
    const { error: insErr } = await supabase.from("audition_recordings").insert({
      space_id: room.id,
      egress_id: rec.egressId,
      storage_key: rec.storageKey,
      started_by: ctx.userId,
    });
    if (insErr) throw new Error(insErr.message);
    // Mirror's columns too, so room teardown and the token route see it.
    await supabase.from("spaces").update(startRecordingUpdate(rec.egressId, rec.storageKey)).eq("id", room.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auditions/recording] egress failed", (err as Error)?.message);
    if (egressId) await stopRoomRecording(egressId);
    await setRoomRecordingFlag(roomName, false).catch(() => undefined);
    return NextResponse.json({ error: "Couldn't start recording. Try again." }, { status: 502 });
  }
}

// GET /api/auditions/[spaceId]/recording?id=<take>[&download=1]
// Director-only signed link to play or download one take. Downloading stamps
// downloaded_at, which only feeds the End warning.
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const ctx = await loadAuditionContext((await params).spaceId, guard.membership.userId!);
  if (isContextFailure(ctx)) return ctx;
  if (!ctx.isHost) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid recording" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data: take } = await supabase
    .from("audition_recordings")
    .select("id, storage_key, started_at, stopped_at")
    .eq("id", id)
    .eq("space_id", ctx.room.id)
    .maybeSingle();
  if (!take) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!take.stopped_at) {
    return NextResponse.json({ error: "Stop the recording first" }, { status: 409 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  const stamp = take.started_at.slice(0, 16).replace(/[:T]/g, "-");
  const { data, error } = await supabase.storage
    .from(recordingsBucket())
    .createSignedUrl(take.storage_key, PLAY_URL_TTL_SECONDS, {
      download: download ? `audition-${stamp}.mp4` : undefined,
    });
  if (error || !data?.signedUrl) {
    // Egress finalizes the MP4 a few seconds after stop.
    return NextResponse.json({ error: "Still saving. Try again in a few seconds." }, { status: 409 });
  }
  if (download) {
    await supabase
      .from("audition_recordings")
      .update({ downloaded_at: new Date().toISOString() })
      .eq("id", take.id);
  }
  return NextResponse.json({ url: data.signedUrl });
}
