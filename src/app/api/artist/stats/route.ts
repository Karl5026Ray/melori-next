import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ensureArtistRow } from "@/lib/artist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/artist/stats — the caller's dashboard KPIs plus their releases and
// pending submissions. If the caller isn't linked to any artist row yet we
// return zeros and an empty release list so the UI can show a "link my artist
// profile" prompt.
export async function GET(req: Request) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  let { data: artist } = await supabase
    .from("artists")
    .select("id, name, slug, avatar_url, cover_image_url, is_featured, is_verified")
    .eq("profile_id", userId)
    .maybeSingle();

  // Self-heal: the caller passed requireArtist, so they're an artist-tier member.
  // If no artists row is linked yet (e.g. role granted before this backfill
  // existed), create one now and re-read so stats populate on first load.
  if (!artist) {
    const ensured = await ensureArtistRow(userId, {}, supabase);
    if (ensured.id) {
      const reread = await supabase
        .from("artists")
        .select("id, name, slug, avatar_url, cover_image_url, is_featured, is_verified")
        .eq("profile_id", userId)
        .maybeSingle();
      artist = reread.data;
    }
  }

  // If not linked, still return submissions so the pending-uploads section works.
  const submissionsPromise = supabase
    .from("track_submissions")
    .select("id, title, status, created_at, reviewed_at, reviewer_notes, release_type")
    .eq("profile_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!artist) {
    const { data: subs } = await submissionsPromise;
    return NextResponse.json({
      artist: null,
      totals: { releases: 0, tracks: 0, pending: subs?.filter((s) => s.status === "pending").length ?? 0 },
      releases: [],
      submissions: subs ?? [],
    });
  }

  const [
    { data: releases },
    { count: trackCount },
    { data: subs },
  ] = await Promise.all([
    supabase
      .from("releases")
      .select("id, title, slug, cover_art_url, release_type, release_date, is_published")
      .eq("artist_id", artist.id)
      .order("release_date", { ascending: false, nullsFirst: false }),
    supabase
      .from("tracks")
      .select("id", { count: "exact", head: true })
      .in(
        "release_id",
        (await supabase.from("releases").select("id").eq("artist_id", artist.id)).data?.map(
          (r: any) => r.id,
        ) ?? [-1],
      ),
    submissionsPromise,
  ]);

  return NextResponse.json({
    artist,
    totals: {
      releases: releases?.length ?? 0,
      tracks: trackCount ?? 0,
      pending: subs?.filter((s) => s.status === "pending").length ?? 0,
    },
    releases: releases ?? [],
    submissions: subs ?? [],
  });
}
