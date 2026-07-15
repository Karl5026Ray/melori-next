import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/tracks/[id] — single published track metadata (no signed audio URL).
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: track, error } = await supabaseAdmin
      .from("tracks")
      .select(
        "id, title, release_id, track_number, duration_seconds, preview_url, price, is_published, created_at",
      )
      .eq("id", id)
      .eq("is_published", true)
      .eq("moderation_status", "clean") // publish-first: hide flagged/removed tracks
      .maybeSingle();

    if (error) throw error;
    if (!track) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ track });
  } catch (err) {
    console.error(`GET /api/tracks/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Failed to load track" },
      { status: 500 },
    );
  }
}
