import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TargetType = "video" | "photo";
function normalizeType(v: unknown): TargetType | null {
  return v === "video" || v === "photo" ? v : null;
}

// GET /api/social/reshares?user_id=<uuid>  → that member's reshares (Shared tab)
//   Public: a profile's "Shared" is visible to anyone viewing the profile.
//   Falls back to the caller's own reshares when user_id is omitted.
export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const url = new URL(req.url);
  let userId = url.searchParams.get("user_id");

  if (!userId) {
    const { getRequestMembership } = await import("@/lib/membership-server");
    const m = await getRequestMembership(req);
    userId = m.userId;
  }
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const { data: shares, error } = await supabase
    .from("content_reshares")
    .select("id, target_type, target_id, caption, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const videoIds = (shares ?? [])
    .filter((s) => s.target_type === "video")
    .map((s) => s.target_id);
  const photoIds = (shares ?? [])
    .filter((s) => s.target_type === "photo")
    .map((s) => s.target_id);

  const [videosRes, photosRes] = await Promise.all([
    videoIds.length
      ? supabase
          .from("social_videos")
          .select(
            "id, title, thumbnail_url, video_url, media_type, likes_count, comments_count",
          )
          .in("id", videoIds)
      : Promise.resolve({ data: [] as any[] }),
    photoIds.length
      ? supabase
          .from("profile_gallery")
          .select("id, image_url, media_type, likes_count, profile_id")
          .in("id", photoIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const videoMap = new Map((videosRes.data ?? []).map((v) => [v.id, v]));
  const photoMap = new Map((photosRes.data ?? []).map((p) => [p.id, p]));

  const items = (shares ?? [])
    .map((s) => {
      const content =
        s.target_type === "video"
          ? videoMap.get(s.target_id)
          : photoMap.get(s.target_id);
      if (!content) return null;
      return { ...s, content };
    })
    .filter(Boolean);

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST /api/social/reshares  { target_type, target_id, caption? } → toggle.
// Re-sharing an already-shared item removes it (idempotent toggle), matching
// the like/save UX.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const supabase = getSupabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const type = normalizeType(body?.target_type);
  const targetId = String(body?.target_id ?? "").trim();
  const caption =
    typeof body?.caption === "string" ? body.caption.slice(0, 500) : null;
  if (!type || !targetId) {
    return NextResponse.json(
      { error: "target_type (video|photo) and target_id are required" },
      { status: 400 },
    );
  }

  const { data: existing } = await supabase
    .from("content_reshares")
    .select("id")
    .eq("user_id", userId)
    .eq("target_type", type)
    .eq("target_id", targetId)
    .maybeSingle();

  let shared: boolean;
  if (existing) {
    const { error } = await supabase
      .from("content_reshares")
      .delete()
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    shared = false;
  } else {
    const { error } = await supabase
      .from("content_reshares")
      .insert({
        user_id: userId,
        target_type: type,
        target_id: targetId,
        caption,
      });
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    shared = true;
  }

  return NextResponse.json({ shared });
}
