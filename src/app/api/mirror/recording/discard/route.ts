import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { waitForEgressEnd } from "@/lib/livekitServer";
import { discardRecording, recordingsBucket } from "@/lib/mirrorRecording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mirror/recording/discard
// Answers "Post this LIVE to the Mirror?" with NOT NOW. The host decides what
// happens to a recording of their room, and "not now" means it is DELETED —
// nobody else reviews or approves it, and nothing is kept "just in case".
//
// Deletes the MP4 from the private recordings bucket (after waiting for egress
// to finish uploading, so the delete can't race the upload and leave a file
// behind) and clears the recording columns on the space row. There is no
// social_videos row for an unposted recording, so nothing else to remove.
//
// Body: { spaceId: string }
export async function POST(req: NextRequest) {
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const spaceId = String(body.spaceId ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: space, error: fetchErr } = await supabase
    .from("spaces")
    .select("id, host_id, recording_egress_id, recording_storage_key")
    .eq("id", spaceId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.host_id !== userId) {
    return NextResponse.json(
      { error: "Only the host can discard this recording" },
      { status: 403 }
    );
  }

  const result = await discardRecording(space, recordingsBucket(), {
    waitForEgressEnd: async (egressId) => {
      await waitForEgressEnd(egressId);
    },
    removeObject: async (bucket, key) => {
      const { error } = await supabase.storage.from(bucket).remove([key]);
      return { error: error?.message ?? null };
    },
    clearSpace: async (update) => {
      const { error } = await supabase.from("spaces").update(update).eq("id", spaceId);
      return { error: error?.message ?? null };
    },
  });

  if (!result.ok) {
    console.error("[mirror/recording/discard] failed", result.error);
    return NextResponse.json(
      { error: "Could not delete the recording. Please try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, deleted: result.deleted });
}
