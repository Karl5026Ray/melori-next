import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/artists — all published artists.
export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("artists")
      .select("*")
      .eq("is_published", true)
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ artists: data ?? [] });
  } catch (err) {
    console.error("GET /api/artists failed:", err);
    return NextResponse.json(
      { error: "Failed to load artists" },
      { status: 500 },
    );
  }
}
