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

// GET /api/admin/tracks — every track (published or not) with release + artist.
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
      .from("tracks")
      .select(
        "id, title, audio_url, preview_url, preview_start, preview_end, duration_seconds, price, is_published, release_id, release:releases(title, artist:artists(name))",
      )
      .order("id", { ascending: false });

    if (error) throw error;

    const tracks = (data ?? []).map((row: any) => {
      const release = firstOrSelf(row.release);
      const artist = release ? firstOrSelf(release.artist) : null;
      return {
        id: row.id,
        title: row.title,
        audio_url: row.audio_url,
        preview_url: row.preview_url,
        preview_start: row.preview_start ?? 0,
        preview_end: row.preview_end ?? 30,
        duration_seconds: row.duration_seconds,
        price: row.price,
        is_published: row.is_published,
        release_id: row.release_id,
        release_title: release?.title ?? null,
        artist_name: artist?.name ?? null,
      };
    });

    return NextResponse.json({ tracks });
  } catch (err: any) {
    console.error("GET /api/admin/tracks failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load tracks" },
      { status: 500 },
    );
  }
}

// POST /api/admin/tracks — create a track row in the PUBLIC catalog.
export async function POST(req: NextRequest) {
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
    const body = await req.json().catch(() => ({}));

    const title = String(body.title ?? "").trim();
    const audioUrl = String(body.audio_url ?? "").trim();
    if (!title || !audioUrl) {
      return NextResponse.json(
        { error: "title and audio_url are required" },
        { status: 400 },
      );
    }

    const duration =
      body.duration_seconds != null ? Math.round(Number(body.duration_seconds)) : null;
    let previewStart = Number(body.preview_start ?? 0);
    let previewEnd = Number(body.preview_end ?? 30);
    if (!Number.isFinite(previewStart) || previewStart < 0) previewStart = 0;
    if (!Number.isFinite(previewEnd) || previewEnd <= previewStart) {
      previewEnd = previewStart + 30;
    }

    const previewUrl =
      typeof body.preview_url === "string" && body.preview_url.trim()
        ? body.preview_url.trim()
        : null;
    const isPublished = Boolean(body.is_published);

    // A newly-created track can only go live if it has a dedicated preview.
    // See PATCH handler for the rationale (free-listener cap is cosmetic).
    if (isPublished && !previewUrl) {
      return NextResponse.json(
        {
          error:
            "Cannot publish: this track has no preview clip. Create it as unpublished, generate a preview, then publish.",
        },
        { status: 400 },
      );
    }

    const insert: Record<string, any> = {
      title,
      audio_url: audioUrl,
      preview_url: previewUrl,
      preview_start: previewStart,
      preview_end: previewEnd,
      duration_seconds: duration,
      is_published: isPublished,
    };
    if (body.release_id != null && body.release_id !== "") {
      insert.release_id = Number(body.release_id);
    }
    if (body.price != null && body.price !== "") {
      insert.price = Number(body.price);
    }
    if (body.track_number != null && body.track_number !== "") {
      insert.track_number = Number(body.track_number);
    }

    const { data, error } = await supabase
      .from("tracks")
      .insert(insert)
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/admin/tracks failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to create track" },
      { status: 500 },
    );
  }
}
