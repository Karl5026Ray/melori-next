import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/releases — all published releases, each with a minimal embedded artist.
export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("releases")
      .select(
        "id, title, slug, release_type, cover_art_url, price, release_date, artist:artists(name, slug)",
      )
      .eq("is_published", true)
      .order("release_date", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ releases: data ?? [] });
  } catch (err) {
    console.error("GET /api/releases failed:", err);
    return NextResponse.json(
      { error: "Failed to load releases" },
      { status: 500 },
    );
  }
}
