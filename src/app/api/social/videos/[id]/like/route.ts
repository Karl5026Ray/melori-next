import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/videos/[id]/like
// Returns whether the current caller likes this video + the live like count.
// Auth-optional: logged-out callers get { liked: false } but still the count.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const videoId = params.id;
  const supabase = getSupabaseAdmin();

  const { data: video } = await supabase
    .from("social_videos")
    .select("likes_count")
    .eq("id", videoId)
    .maybeSingle();

  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  // Resolve the caller (optional).
  const { membership } = { membership: await getCaller(req) };
  let liked = false;
  if (membership) {
    const { data: like } = await supabase
      .from("social_video_likes")
      .select("id")
      .eq("video_id", videoId)
      .eq("user_id", membership)
      .maybeSingle();
    liked = !!like;
  }

  return NextResponse.json(
    { liked, likesCount: video.likes_count ?? 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST /api/social/videos/[id]/like — toggle the caller's like.
// Any signed-in user may like. The like row's UNIQUE (video_id, user_id) makes
// this idempotent, and DB triggers keep social_videos.likes_count in sync, so
// we never mutate the counter by hand (no lost-update races).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const videoId = params.id;

  const supabase = getSupabaseAdmin();

  // Does the video exist? (FK would reject anyway, but we want a clean 404.)
  const { data: video } = await supabase
    .from("social_videos")
    .select("id")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  // Is it already liked? Toggle accordingly.
  const { data: existing } = await supabase
    .from("social_video_likes")
    .select("id")
    .eq("video_id", videoId)
    .eq("user_id", userId)
    .maybeSingle();

  let liked: boolean;
  if (existing) {
    const { error } = await supabase
      .from("social_video_likes")
      .delete()
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    liked = false;
  } else {
    const { error } = await supabase
      .from("social_video_likes")
      .insert({ video_id: videoId, user_id: userId });
    // Ignore a unique-violation race (23505): someone double-tapped; the like
    // already exists, which is the desired end state.
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    liked = true;
  }

  // Read the trigger-maintained count back so the client shows the truth.
  const { data: fresh } = await supabase
    .from("social_videos")
    .select("likes_count")
    .eq("id", videoId)
    .maybeSingle();

  return NextResponse.json({ liked, likesCount: fresh?.likes_count ?? 0 });
}

// Minimal caller resolution that tolerates logged-out requests for GET.
async function getCaller(req: Request): Promise<string | null> {
  const { getRequestMembership } = await import("@/lib/membership-server");
  const m = await getRequestMembership(req);
  return m.userId;
}
