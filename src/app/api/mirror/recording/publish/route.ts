import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { revalidatePath } from "next/cache";
import { waitForEgressEnd } from "@/lib/livekitServer";
import {
  publicObjectUrl,
  publicVideoBucket,
  recordingsBucket,
} from "@/lib/mirrorRecording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mirror/recording/publish
// Answers the "Would you like to post this LIVE to the Mirror?" prompt with YES.
// Turns a finished live recording into a Mirror post (a `social_videos` row),
// which is exactly how every other Mirror video is modeled — so it flows through
// the same feed, likes, comments, delete and report paths.
//
// Body: { spaceId: string, title?: string, description?: string }
// The recording is located from the space row (never trusted from the client)
// so a caller can only publish the recording that actually belongs to their live.
//
// PRIVATE UNTIL POSTED: egress writes into the private recordings bucket. Only
// here — the host's explicit "Post it" — is the MP4 copied into the public
// bucket every other Mirror video already plays from, and only then does a
// public URL exist. Copying (rather than serving signed URLs) keeps
// social_videos.video_url a plain public URL, so feed, profile grids, share
// links and the player work unchanged. The private original is then deleted.
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
    .select("id, host_id, title, recording_url, recording_storage_key, recording_egress_id")
    .eq("id", spaceId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.host_id !== userId) {
    return NextResponse.json(
      { error: "Only the host can post this live" },
      { status: 403 }
    );
  }
  // recording_url is only ever set once a recording is public: either it was
  // copied by an earlier publish attempt, or it is a legacy recording made
  // before recordings went private. Otherwise copy it out of the private bucket.
  let videoUrl: string | null = space.recording_url ?? null;
  if (!videoUrl) {
    const key = space.recording_storage_key;
    if (!key) {
      return NextResponse.json(
        { error: "This live has no recording to post." },
        { status: 409 }
      );
    }
    // The MP4 finishes uploading a few seconds after stop; don't copy a file
    // that isn't there yet.
    if (space.recording_egress_id) await waitForEgressEnd(space.recording_egress_id);

    const privateBucket = recordingsBucket();
    const publicBucket = publicVideoBucket();
    const { error: copyErr } = await supabase.storage
      .from(privateBucket)
      .copy(key, key, { destinationBucket: publicBucket });
    if (copyErr) {
      console.error("[mirror/recording/publish] copy failed", copyErr.message);
      return NextResponse.json(
        { error: "Your recording is still processing. Try posting again in a moment." },
        { status: 409 }
      );
    }
    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    videoUrl = publicObjectUrl(supabaseUrl, publicBucket, key);

    // Remember the public copy first (so a retry after a failed insert reuses
    // it), then drop the private original.
    await supabase
      .from("spaces")
      .update({ recording_url: videoUrl, recording_storage_key: null })
      .eq("id", spaceId);
    const { error: rmErr } = await supabase.storage.from(privateBucket).remove([key]);
    if (rmErr) console.warn("[mirror/recording/publish] private cleanup failed", rmErr.message);
  }

  const title =
    (typeof body.title === "string" && body.title.trim()) ||
    space.title ||
    "Live on Melori Mirror";
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const { data, error } = await supabase
    .from("social_videos")
    .insert({
      user_id: userId,
      title,
      description,
      video_url: videoUrl,
      thumbnail_url: null,
      media_type: "video",
      // A live recording is a LiveKit RoomComposite, and that composite is
      // rendered landscape (the default 720p preset is 1280x720). Saying so
      // explicitly keeps the player from squeezing it into the portrait stage,
      // which shrank every posted live to a thin letterboxed strip.
      is_vertical: false,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[mirror/recording/publish] insert error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mirror feed + home feed pull from social_videos; bust their caches so the
  // freshly posted live shows up immediately.
  revalidatePath("/");
  revalidatePath("/social/mirror");

  return NextResponse.json({ ok: true, video: data });
}
