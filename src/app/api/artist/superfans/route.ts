import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

// GET /api/artist/superfans?limit=5
// Private: the calling artist's own top listeners.
// Returns richer detail than the public counterpart (favorite album, most
// recent listen date) so the Studio dashboard has more to show.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const supabase = getSupabaseAdmin();
  const artistOwnerId = guard.membership.userId;
  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(requested)))
    : DEFAULT_LIMIT;

  try {
    // Pull the artist's listen events. Cap the working set — a very hot artist
    // could accumulate huge volume, and the top-N is stable long before that.
    // For MVP scale (single-digit artists) 10k is fine; when this scales we'll
    // move to a materialized view or a scheduled aggregation.
    const { data: rows, error } = await supabase
      .from("track_listens")
      .select("listener_id, studio_track_id, legacy_track_id, listened_at")
      .eq("artist_owner_id", artistOwnerId)
      .order("listened_at", { ascending: false })
      .limit(10000);

    if (error) throw error;
    const listens = rows ?? [];

    if (listens.length === 0) {
      return NextResponse.json({ superfans: [], total_listeners: 0 });
    }

    // Aggregate per listener: play count, per-track play tally, most recent
    // listen date. Track ids are namespaced by prefix ('s:' or 'l:') to keep
    // the two sources distinct while sharing a single map.
    type PerListener = {
      plays: number;
      lastListen: string;
      byTrack: Map<string, number>;
    };
    const perListener = new Map<string, PerListener>();

    for (const r of listens) {
      const trackKey = r.studio_track_id
        ? `s:${r.studio_track_id}`
        : `l:${r.legacy_track_id}`;
      const entry = perListener.get(r.listener_id) ?? {
        plays: 0,
        lastListen: r.listened_at,
        byTrack: new Map<string, number>(),
      };
      entry.plays += 1;
      entry.byTrack.set(trackKey, (entry.byTrack.get(trackKey) ?? 0) + 1);
      // rows come DESC, so the first-seen listened_at per listener is newest
      if (!perListener.has(r.listener_id)) {
        entry.lastListen = r.listened_at;
      }
      perListener.set(r.listener_id, entry);
    }

    // Rank by total plays, then most recent listen as tiebreaker
    const ranked = Array.from(perListener.entries())
      .map(([listener_id, v]) => ({
        listener_id,
        plays: v.plays,
        last_listen: v.lastListen,
        favorite_track_key: [...v.byTrack.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0][0],
      }))
      .sort((a, b) =>
        b.plays !== a.plays
          ? b.plays - a.plays
          : new Date(b.last_listen).getTime() -
            new Date(a.last_listen).getTime(),
      )
      .slice(0, limit);

    // Batch-fetch profile info for the top listeners
    const listenerIds = ranked.map((r) => r.listener_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, full_name, avatar_url")
      .in("id", listenerIds);
    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.id, p]),
    );

    // Batch-fetch favorite track titles/albums. Split by source type.
    const studioIds = ranked
      .filter((r) => r.favorite_track_key.startsWith("s:"))
      .map((r) => r.favorite_track_key.slice(2));
    const legacyIds = ranked
      .filter((r) => r.favorite_track_key.startsWith("l:"))
      .map((r) => Number(r.favorite_track_key.slice(2)));

    const [studioTracks, legacyTracks] = await Promise.all([
      studioIds.length
        ? supabase
            .from("studio_tracks")
            .select("id, title, album")
            .in("id", studioIds)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      legacyIds.length
        ? supabase
            .from("tracks")
            .select("id, title, release:releases!inner(title)")
            .in("id", legacyIds)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
    ]);
    const studioTitleMap = new Map(
      (studioTracks as any[]).map((t) => [
        `s:${t.id}`,
        { title: t.title as string, album: t.album as string | null },
      ]),
    );
    const legacyTitleMap = new Map(
      (legacyTracks as any[]).map((t) => {
        const rel = Array.isArray(t.release) ? t.release[0] : t.release;
        return [
          `l:${t.id}`,
          { title: t.title as string, album: (rel?.title ?? null) as string | null },
        ];
      }),
    );

    const superfans = ranked.map((r, idx) => {
      const profile = profileMap.get(r.listener_id);
      const fav =
        studioTitleMap.get(r.favorite_track_key) ??
        legacyTitleMap.get(r.favorite_track_key) ??
        null;
      return {
        rank: idx + 1,
        listener_id: r.listener_id,
        display_name:
          profile?.display_name?.trim() ||
          profile?.full_name?.trim() ||
          "Anonymous fan",
        avatar_url: profile?.avatar_url ?? null,
        plays: r.plays,
        last_listen: r.last_listen,
        favorite_track: fav?.title ?? null,
        favorite_album: fav?.album ?? null,
      };
    });

    return NextResponse.json({
      superfans,
      total_listeners: perListener.size,
    });
  } catch (err) {
    console.error("GET /api/artist/superfans failed:", err);
    return NextResponse.json(
      { error: "Failed to load superfans" },
      { status: 500 },
    );
  }
}
