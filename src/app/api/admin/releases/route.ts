import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

function firstOrSelf<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// GET /api/admin/releases — every release (published or not) with its artist
// name and full track list. Tracks are returned in track_number order and are
// NOT moderation-filtered, so admins see the complete catalog for each album.
export async function GET(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }

  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("releases")
      .select(
        "id, title, slug, release_type, cover_art_url, price, is_published, created_at, artist:artists(name), tracks(id, title, track_number, is_published, duration_seconds)",
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    const releases = (data ?? []).map((row: any) => {
      const artist = firstOrSelf(row.artist);
      const tracks = ((row.tracks as any[]) ?? []).sort(
        (a, b) => (a.track_number ?? 0) - (b.track_number ?? 0),
      );
      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        release_type: row.release_type,
        cover_art_url: row.cover_art_url,
        price: row.price,
        is_published: row.is_published,
        artist_name: artist?.name ?? null,
        track_count: tracks.length,
        tracks: tracks.map((t) => ({
          id: t.id,
          title: t.title,
          track_number: t.track_number,
          is_published: t.is_published,
          duration_seconds: t.duration_seconds,
        })),
      };
    });

    return NextResponse.json({ releases });
  } catch (err: any) {
    console.error("GET /api/admin/releases failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load releases" },
      { status: 500 },
    );
  }
}
