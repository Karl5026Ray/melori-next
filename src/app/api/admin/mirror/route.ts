import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminGuardFailure } from "@/lib/admin-panel";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;

// GET /api/admin/mirror?source=all|upload|youtube&scope=live|all
//   Moderation listing for the Melori Mirror feed. `scope=live` (default) shows
//   what members can currently see — the same expires_at filter the public feed
//   uses — while `scope=all` also surfaces posts inside the 10-minute window
//   between expiry and the pg_cron rotation sweep.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  const url = req.nextUrl;
  const source = url.searchParams.get("source") ?? "all";
  const scope = url.searchParams.get("scope") ?? "live";

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("social_videos")
    .select(
      `id, user_id, title, description, video_url, thumbnail_url, media_type,
       source, youtube_id, likes_count, comments_count, created_at, expires_at,
       user:profiles!social_videos_user_id_fkey(
         id, display_name, username, avatar_url, verified, role
       )`,
    )
    .order("created_at", { ascending: false })
    .limit(MAX_LIMIT);

  if (scope !== "all") {
    query = query.gt("expires_at", new Date().toISOString());
  }
  if (source === "upload" || source === "youtube") {
    query = query.eq("source", source);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Admin mirror list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}
