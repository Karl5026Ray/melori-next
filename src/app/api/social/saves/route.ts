import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Saves (bookmarks) are polymorphic over content types. target_type gates
// target_id so one table backs both the Mirror reels and gallery photos.
type TargetType = "video" | "photo";
function normalizeType(v: unknown): TargetType | null {
  return v === "video" || v === "photo" ? v : null;
}

// GET /api/social/saves            → the caller's saved items (Saves tab)
// GET /api/social/saves?target_type=video&target_id=<uuid>
//                                  → { saved: boolean } for a single item
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const supabase = getSupabaseAdmin();

  const url = new URL(req.url);
  const type = normalizeType(url.searchParams.get("target_type"));
  const targetId = url.searchParams.get("target_id");

  // Single-item check mode.
  if (type && targetId) {
    const { data } = await supabase
      .from("content_saves")
      .select("target_id")
      .eq("user_id", userId)
      .eq("target_type", type)
      .eq("target_id", targetId)
      .maybeSingle();
    return NextResponse.json(
      { saved: !!data },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // List mode: the caller's saves, newest first, hydrated with the underlying
  // content so the tab can render tiles without an N+1 from the client.
  const { data: saves, error } = await supabase
    .from("content_saves")
    .select("target_type, target_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const videoIds = (saves ?? [])
    .filter((s) => s.target_type === "video")
    .map((s) => s.target_id);
  const photoIds = (saves ?? [])
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

  const items = (saves ?? [])
    .map((s) => {
      const content =
        s.target_type === "video"
          ? videoMap.get(s.target_id)
          : photoMap.get(s.target_id);
      if (!content) return null; // underlying content was deleted/expired
      return { ...s, content };
    })
    .filter(Boolean);

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST /api/social/saves  { target_type, target_id }  → toggle the save.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const supabase = getSupabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const type = normalizeType(body?.target_type);
  const targetId = String(body?.target_id ?? "").trim();
  if (!type || !targetId) {
    return NextResponse.json(
      { error: "target_type (video|photo) and target_id are required" },
      { status: 400 },
    );
  }

  // Toggle: delete if present, insert otherwise.
  const { data: existing } = await supabase
    .from("content_saves")
    .select("target_id")
    .eq("user_id", userId)
    .eq("target_type", type)
    .eq("target_id", targetId)
    .maybeSingle();

  let saved: boolean;
  if (existing) {
    const { error } = await supabase
      .from("content_saves")
      .delete()
      .eq("user_id", userId)
      .eq("target_type", type)
      .eq("target_id", targetId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    saved = false;
  } else {
    const { error } = await supabase
      .from("content_saves")
      .insert({ user_id: userId, target_type: type, target_id: targetId });
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    saved = true;
  }

  return NextResponse.json({ saved });
}
