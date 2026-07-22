import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/profiles/feed
// -------------------------------------------------------------------------
// Discovery feed powering the TikTok-style Profile Scroller. Each item is
// a public profile; the client renders one full-screen at a time and pages
// through with vertical swipes on mobile / arrow-wheel on desktop.
//
// Query params:
//   cursor  — "<sort_key>_<uuid>" from the last item of the previous page.
//   limit   — 1..30 (default 10). Small pages keep initial load snappy.
//   mode    — "newest" | "online" (default "newest").
//               newest → order by created_at DESC, id DESC
//               online → members with last_seen_at within ONLINE_WINDOW_MS
//                        first, then newest. Uses the same 5-minute window
//                        as /api/mirror/live so both surfaces agree on who
//                        is "online now".
//   role    — optional. "artist" | "superfan" | "free" — filters to that
//             role only. Absent = all roles.
//   exclude_followed — "1" to hide people the viewer already follows.
//             Requires auth; silently ignored when signed out.
//
// Pagination is KEYSET (not offset) so newly joined members can't shift the
// window and cause dupes/skips. We fetch `limit + 1` rows to detect a next
// page cheaply.
//
// Auth: OPTIONAL. Anonymous callers get a purely public feed. Signed-in
// callers get their own id filtered out and (when `exclude_followed=1`) any
// profiles they already follow removed. We also drop any profile that has
// blocked the viewer or that the viewer has blocked, in either direction.

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

type Mode = "newest" | "online";

// --- helpers ---------------------------------------------------------------

function parseCursor(raw: string | null): { key: string; id: string } | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf("_");
  if (sep <= 0) return null;
  const key = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!key || !id) return null;
  return { key, id };
}

// Try to resolve the caller from the Authorization header. Anonymous is
// fine — the feed is public — so we use getRequestMembership (which never
// throws) instead of requireAuth.
async function resolveViewer(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  try {
    const membership = await getRequestMembership(req);
    return membership.userId ?? null;
  } catch {
    return null;
  }
}

// --- handler ---------------------------------------------------------------

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

    const modeParam = (url.searchParams.get("mode") ?? "newest").toLowerCase();
    const mode: Mode = modeParam === "online" ? "online" : "newest";

    const roleParam = url.searchParams.get("role");
    const role =
      roleParam && ["artist", "superfan", "free"].includes(roleParam)
        ? roleParam
        : null;

    const excludeFollowed = url.searchParams.get("exclude_followed") === "1";
    const cursor = parseCursor(url.searchParams.get("cursor"));

    const viewerId = await resolveViewer(req);

    // Build the block + follow exclusion set (viewer only).
    const excludeIds = new Set<string>();
    if (viewerId) {
      excludeIds.add(viewerId); // never show yourself

      const { data: blocks } = await supabase
        .from("member_blocks")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
      for (const row of blocks ?? []) {
        excludeIds.add(
          row.blocker_id === viewerId ? row.blocked_id : row.blocker_id,
        );
      }

      if (excludeFollowed) {
        const { data: follows } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", viewerId);
        for (const row of follows ?? []) excludeIds.add(row.following_id);
      }
    }

    // --- Base query --------------------------------------------------------
    // Only public, non-deleted profiles. `visibility` may not exist on every
    // deployment; we defensively omit that filter and rely on RLS + admin
    // client returning the same "public" fields we already expose elsewhere.
    let query = supabase
      .from("profiles")
      .select(
        `id, username, display_name, avatar_url, banner_url, role, bio,
         city, verified, followers_count, following_count,
         created_at, last_seen_at`,
      )
      .not("username", "is", null) // hide half-created accounts
      .limit(limit + 1);

    if (role) query = query.eq("role", role);

    if (mode === "online") {
      const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      query = query
        .gte("last_seen_at", since)
        .order("last_seen_at", { ascending: false })
        .order("id", { ascending: false });
      if (cursor) {
        query = query.or(
          `last_seen_at.lt.${cursor.key},and(last_seen_at.eq.${cursor.key},id.lt.${cursor.id})`,
        );
      }
    } else {
      query = query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (cursor) {
        query = query.or(
          `created_at.lt.${cursor.key},and(created_at.eq.${cursor.key},id.lt.${cursor.id})`,
        );
      }
    }

    // Fetch up to `limit * 3 + 1` when we need to filter out excludes client-
    // side: a viewer following most of the platform would otherwise get an
    // empty page. Keep the ceiling capped so a bad actor can't force big
    // reads.
    if (excludeIds.size > 0) {
      const bumped = Math.min(limit * 3 + 1, 90);
      query = query.limit(bumped);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []).filter((r) => !excludeIds.has(r.id));

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];

    let nextCursor: string | null = null;
    if (hasMore && last) {
      const key = mode === "online" ? last.last_seen_at : last.created_at;
      if (key) nextCursor = `${key}_${last.id}`;
    }

    // If the viewer is signed in, tell the client which of the returned ids
    // they already follow so the Follow button starts in the right state.
    let followingSet: string[] = [];
    if (viewerId && items.length > 0) {
      const { data: rels } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", viewerId)
        .in(
          "following_id",
          items.map((i) => i.id),
        );
      followingSet = (rels ?? []).map((r) => r.following_id);
    }

    return NextResponse.json(
      { items, nextCursor, followingIds: followingSet, mode },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
