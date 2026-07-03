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

// PATCH /api/admin/tracks/[id] — update editable fields (incl. preview window).
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

    if (typeof body.title === "string") update.title = body.title.trim();
    if (typeof body.is_published === "boolean")
      update.is_published = body.is_published;
    if (body.price != null && body.price !== "")
      update.price = Number(body.price);
    if (body.preview_start != null) {
      const s = Number(body.preview_start);
      if (Number.isFinite(s) && s >= 0) update.preview_start = s;
    }
    if (body.preview_end != null) {
      const e = Number(body.preview_end);
      if (Number.isFinite(e) && e >= 0) update.preview_end = e;
    }
    if (
      update.preview_start != null &&
      update.preview_end != null &&
      update.preview_end <= update.preview_start
    ) {
      update.preview_end = update.preview_start + 30;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error } = await supabase.from("tracks").update(update).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`PATCH /api/admin/tracks/${params.id} failed:`, err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to update track" },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/tracks/[id] — remove a track row.
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
    const { error } = await supabase.from("tracks").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`DELETE /api/admin/tracks/${params.id} failed:`, err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete track" },
      { status: 500 },
    );
  }
}
