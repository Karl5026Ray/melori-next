import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mirror/feed?cursor=<created_at>_<id>&limit=10
// -------------------------------------------------------------------------
// The scrollable Melori Mirror feed (social video / audio posts). Kept as a
// SEPARATE endpoint from /api/mirror/live so live-room churn never invalidates
// feed pagination.
//
// Pagination is KEYSET (not offset): we page on (created_at DESC, id DESC).
// Offset pagination drifts as new posts arrive at the top; keyset is stable.
//
// GROUNDWORK for the Kimi "24-hour rotation" plan: social_videos has no
// expires_at yet, so nothing is filtered by expiry today. When the feed_items
// / expires_at migration lands, add `.gt("expires_at", nowIso)` here and the
// rotation switches on with no client change.
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);

    const limit = Math.min(
      Math.max(
        parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) ||
          DEFAULT_LIMIT,
        1,
      ),
      MAX_LIMIT,
    );

    // Cursor format: "<ISO created_at>_<uuid id>" from the last item of the
    // previous page. Absent on the first page.
    const rawCursor = url.searchParams.get("cursor");
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    if (rawCursor) {
      const sep = rawCursor.indexOf("_");
      if (sep > 0) {
        cursorCreatedAt = rawCursor.slice(0, sep);
        cursorId = rawCursor.slice(sep + 1);
      }
    }

    let query = supabase
      .from("social_videos")
      .select(
        `id, user_id, title, description, video_url, thumbnail_url,
         likes_count, comments_count, created_at, media_type,
         user:profiles!social_videos_user_id_fkey(
           id, display_name, username, avatar_url, verified, role
         )`,
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1); // fetch one extra to know if another page exists

    if (cursorCreatedAt && cursorId) {
      // Strict "older than the cursor" comparison, tie-broken by id.
      query = query.or(
        `created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? `${last.created_at}_${last.id}` : null;

    return NextResponse.json(
      { items, nextCursor },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
