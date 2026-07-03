import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_SECRET =
  process.env.ADMIN_JWT_SECRET || "melori-admin-fallback-secret";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

// PATCH /api/admin/artists/[id] — update an artist.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json().catch(() => ({}));
    const update: Record<string, any> = {};

    if (typeof body.name === "string") update.name = body.name.trim();
    if (typeof body.slug === "string" && body.slug.trim())
      update.slug = body.slug.trim();
    if ("bio" in body) update.bio = body.bio ?? null;
    if ("avatar_url" in body) update.avatar_url = body.avatar_url ?? null;
    if ("cover_image_url" in body)
      update.cover_image_url = body.cover_image_url ?? null;
    if (typeof body.is_verified === "boolean")
      update.is_verified = body.is_verified;
    if (typeof body.is_published === "boolean")
      update.is_published = body.is_published;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error } = await supabase.from("artists").update(update).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`PATCH /api/admin/artists/${params.id} failed:`, err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to update artist" },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/artists/[id] — remove an artist.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("artists").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`DELETE /api/admin/artists/${params.id} failed:`, err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete artist" },
      { status: 500 },
    );
  }
}
