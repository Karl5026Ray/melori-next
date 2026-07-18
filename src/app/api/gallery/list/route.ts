import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/gallery-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/gallery/list — CLI listing endpoint (API-key auth). Returns the
// caller's galleries with a per-gallery image count.
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  const { userId, supabase } = auth;

  const { data: galleries, error } = await supabase
    .from("photo_galleries")
    .select("id, name, slug, client_name, is_active, created_at")
    .eq("photographer_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("gallery/list query failed", error.message);
    return NextResponse.json(
      { error: "Could not load galleries" },
      { status: 500 },
    );
  }

  const rows = galleries ?? [];

  // Per-gallery image counts (small N — one head-count query each).
  const withCounts = await Promise.all(
    rows.map(async (g) => {
      const { count } = await supabase
        .from("photo_gallery_images")
        .select("id", { count: "exact", head: true })
        .eq("gallery_id", g.id);
      return {
        id: g.id,
        name: g.name,
        slug: g.slug,
        clientName: g.client_name,
        isActive: g.is_active,
        imageCount: count ?? 0,
        createdAt: g.created_at,
      };
    }),
  );

  return NextResponse.json({ galleries: withCounts });
}
