import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/videos — public video feed (most recent first).
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("social_videos")
      .select(
        `*, user:profiles(id, display_name, avatar_url, role, verified)`,
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Social videos list error:", error);
      return NextResponse.json({ videos: [] }, { status: 500 });
    }

    return NextResponse.json({ videos: data ?? [] });
  } catch (err) {
    console.error("Social videos GET error:", err);
    return NextResponse.json({ videos: [] }, { status: 500 });
  }
}

// POST /api/social/videos — persist a video row after the file has been PUT to
// the `social-videos` bucket via /api/studio/upload-url (type: "video"). Only
// artists may publish. user_id is always the caller's uid so a client cannot
// post on someone else's behalf.
//
// Body: { title, video_url, description?, thumbnail_url? }
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const videoUrl =
      typeof body.video_url === "string" ? body.video_url : "";
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    const thumbnailUrl =
      typeof body.thumbnail_url === "string" && body.thumbnail_url
        ? body.thumbnail_url
        : null;

    if (!title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 },
      );
    }
    if (!videoUrl) {
      return NextResponse.json(
        { error: "video_url is required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("social_videos")
      .insert({
        user_id: guard.membership.userId,
        title,
        description,
        video_url: videoUrl,
        thumbnail_url: thumbnailUrl,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Social video insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ...data, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Create social video error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
