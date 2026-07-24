import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mirror/recording/publish
// Answers the "Would you like to post this LIVE to the Mirror?" prompt with YES.
// Turns a finished live recording into a Mirror post (a `social_videos` row),
// which is exactly how every other Mirror video is modeled — so it flows through
// the same feed, likes, comments, delete and report paths.
//
// Body: { spaceId: string, title?: string, description?: string }
// The recording_url is read from the space row (never trusted from the client)
// so a caller can only publish the recording that actually belongs to their live.
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
    .select("id, host_id, title, recording_url")
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
  if (!space.recording_url) {
    return NextResponse.json(
      { error: "This live has no recording to post." },
      { status: 409 }
    );
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
      video_url: space.recording_url,
      thumbnail_url: null,
      media_type: "video",
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
