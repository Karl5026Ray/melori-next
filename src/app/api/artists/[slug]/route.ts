import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/artists/[slug] — a single published artist plus their published releases.
export async function GET(
  _request: Request,
  { params }: { params: { slug: string } },
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: artist, error: artistError } = await supabaseAdmin
      .from("artists")
      .select("*")
      .eq("slug", params.slug)
      .eq("is_published", true)
      .maybeSingle();

    if (artistError) throw artistError;
    if (!artist) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: releases, error: releasesError } = await supabaseAdmin
      .from("releases")
      .select("*")
      .eq("artist_id", artist.id)
      .eq("is_published", true)
      .order("release_date", { ascending: false });

    if (releasesError) throw releasesError;

    return NextResponse.json({ artist, releases: releases ?? [] });
  } catch (err) {
    console.error(`GET /api/artists/${params.slug} failed:`, err);
    return NextResponse.json(
      { error: "Failed to load artist" },
      { status: 500 },
    );
  }
}
