import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/internal/revalidate-track?track=123
// Called by the track-cleanup edge function after a takedown so cached pages
// drop the removed track immediately. Authenticated with a shared bearer secret.
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.REVALIDATE_SECRET ?? ""}`;
  if (!process.env.REVALIDATE_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trackId = Number(req.nextUrl.searchParams.get("track"));
  if (!Number.isInteger(trackId)) {
    return NextResponse.json({ error: "Invalid track id" }, { status: 400 });
  }

  // Look up the owning artist so we can bust its tag too.
  let artistId: number | null = null;
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("tracks")
      .select("release_id, releases(artist_id)")
      .eq("id", trackId)
      .maybeSingle();
    // @ts-expect-error nested select shape
    artistId = data?.releases?.artist_id ?? null;
  } catch {
    /* best-effort */
  }

  if (artistId) revalidateTag(`artist-${artistId}`);
  revalidatePath("/browse");
  revalidatePath("/");

  return NextResponse.json({ ok: true, track: trackId, artist: artistId });
}
