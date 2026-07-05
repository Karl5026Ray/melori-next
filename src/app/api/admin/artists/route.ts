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

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// GET /api/admin/artists — every artist (published or not).
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
      .from("artists")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ artists: data ?? [] });
  } catch (err: any) {
    console.error("GET /api/admin/artists failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load artists" },
      { status: 500 },
    );
  }
}

// POST /api/admin/artists — create an artist.
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

    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const slug = String(body.slug ?? "").trim() || slugify(name);

    const insert: Record<string, any> = {
      name,
      slug,
      bio: body.bio ?? null,
      avatar_url: body.avatar_url ?? null,
      cover_image_url: body.cover_image_url ?? null,
      is_verified: Boolean(body.is_verified),
      is_published: Boolean(body.is_published),
      is_featured: Boolean(body.is_featured),
    };
    if (body.featured_order !== undefined && body.featured_order !== null) {
      const n = Number(body.featured_order);
      if (Number.isFinite(n)) insert.featured_order = n;
    }

    const { data, error } = await supabase
      .from("artists")
      .insert(insert)
      .select("id")
      .single();
    if (error) throw error;

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/admin/artists failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to create artist" },
      { status: 500 },
    );
  }
}
