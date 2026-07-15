import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const LIMIT = 5;

// GET /api/artists/[slug]/superfans
// Public: top 5 listeners for a given artist. Called by the artist profile
// page's SuperfanButton dropdown. No auth required — only names, counts,
// and favorite song titles are exposed (nothing that would identify a fan
// by anything other than the display name they chose themselves).
export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const supabase = getSupabaseAdmin();

  try {
    // Resolve slug -> artists.profile_id (the field used as artist_owner_id
    // on track_listens). We do NOT expose a top-fans list for artists that
    // aren't published — the artist row itself is the gate.
    const { data: artist, error: artistErr } = await supabase
      .from("artists")
      .select("id, profile_id, is_published")
      .eq("slug", params.slug)
      .eq("is_published", true)
      .maybeSingle();

    if (artistErr) throw artistErr;
    if (!artist?.profile_id) {
      // Either the artist doesn't exist or hasn't been linked to a profile.
      // Return an empty list rather than 404 so the UI just hides the button.
      return NextResponse.json({ superfans: [], total_listeners: 0 });
    }

    const artistOwnerId = artist.profile_id as string;

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

    // Same aggregation shape as /api/artist/superfans, but we only expose
    // fields safe for public consumption (no listener_id, no last_listen).
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
      if (!perListener.has(r.listener_id)) {
        entry.lastListen = r.listened_at;
      }
      perListener.set(r.listener_id, entry);
    }

    const ranked = Array.from(perListener.entries())
      .map(([listener_id, v]) => ({
        listener_id,
        plays: v.plays,
        lastListen: v.lastListen,
        favorite_track_key: [...v.byTrack.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0][0],
      }))
      .sort((a, b) =>
        b.plays !== a.plays
          ? b.plays - a.plays
          : new Date(b.lastListen).getTime() - new Date(a.lastListen).getTime(),
      )
      .slice(0, LIMIT);

    const listenerIds = ranked.map((r) => r.listener_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, full_name, avatar_url")
      .in("id", listenerIds);
    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.id, p]),
    );

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
            .select("id, title")
            .in("id", studioIds)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      legacyIds.length
        ? supabase
            .from("tracks")
            .select("id, title")
            .in("id", legacyIds)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
    ]);
    const titleMap = new Map<string, string>();
    for (const t of studioTracks as any[]) titleMap.set(`s:${t.id}`, t.title);
    for (const t of legacyTracks as any[]) titleMap.set(`l:${t.id}`, t.title);

    const superfans = ranked.map((r, idx) => {
      const profile = profileMap.get(r.listener_id);
      return {
        rank: idx + 1,
        display_name:
          profile?.display_name?.trim() ||
          profile?.full_name?.trim() ||
          "Anonymous fan",
        avatar_url: profile?.avatar_url ?? null,
        plays: r.plays,
        favorite_track: titleMap.get(r.favorite_track_key) ?? null,
      };
    });

    return NextResponse.json({
      superfans,
      total_listeners: perListener.size,
    });
  } catch (err) {
    console.error(
      `GET /api/artists/${params.slug}/superfans failed:`,
      err,
    );
    return NextResponse.json(
      { error: "Failed to load superfans" },
      { status: 500 },
    );
  }
}
