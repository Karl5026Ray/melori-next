import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/photos/[id]/like
// Returns whether the caller likes this gallery photo + the live like count.
// Auth-optional: logged-out callers get { liked: false } but still the count.
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id: photoId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { data: photo } = await supabase
    .from("profile_gallery")
    .select("likes_count")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const { getRequestMembership } = await import("@/lib/membership-server");
  const m = await getRequestMembership(req);
  let liked = false;
  if (m.userId) {
    const { data } = await supabase
      .from("profile_gallery_likes")
      .select("gallery_id")
      .eq("gallery_id", photoId)
      .eq("user_id", m.userId)
      .maybeSingle();
    liked = !!data;
  }

  return NextResponse.json(
    { liked, likesCount: photo.likes_count ?? 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST /api/social/photos/[id]/like — toggle the caller's like. The
// UNIQUE (user_id, gallery_id) key makes this idempotent and a DB trigger keeps
// profile_gallery.likes_count in sync, so we never touch the counter by hand.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const { id: photoId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { data: photo } = await supabase
    .from("profile_gallery")
    .select("id")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("profile_gallery_likes")
    .select("gallery_id")
    .eq("gallery_id", photoId)
    .eq("user_id", userId)
    .maybeSingle();

  let liked: boolean;
  if (existing) {
    const { error } = await supabase
      .from("profile_gallery_likes")
      .delete()
      .eq("gallery_id", photoId)
      .eq("user_id", userId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    liked = false;
  } else {
    const { error } = await supabase
      .from("profile_gallery_likes")
      .insert({ gallery_id: photoId, user_id: userId });
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    liked = true;
  }

  const { data: fresh } = await supabase
    .from("profile_gallery")
    .select("likes_count")
    .eq("id", photoId)
    .maybeSingle();

  return NextResponse.json({ liked, likesCount: fresh?.likes_count ?? 0 });
}
