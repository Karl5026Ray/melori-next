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

// PATCH /api/admin/tracks/[id] — update editable fields (incl. preview window).
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
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
    if (typeof body.preview_url === "string")
      update.preview_url = body.preview_url.trim() || null;
    else if (body.preview_url === null) update.preview_url = null;
    if (body.price != null && body.price !== "")
      update.price = Number(body.price);
    if (typeof body.audio_url === "string" && body.audio_url.trim())
      update.audio_url = body.audio_url.trim();
    if (body.duration_seconds != null) {
      const d = Number(body.duration_seconds);
      if (Number.isFinite(d) && d > 0) update.duration_seconds = Math.round(d);
    }
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

    // Enforce a dedicated preview clip whenever a track goes live. Without
    // one, /api/tracks/[id]/stream falls back to serving the full audio to
    // free listeners with only a client-side 30s cap — which is cosmetic
    // (the signed URL is directly fetchable). Publishing is the right
    // gate: unpublished tracks aren't served to free listeners anyway.
    if (update.is_published === true) {
      // preview_url may come from this same PATCH, or already exist on the row.
      let effectivePreview: string | null | undefined = update.preview_url;
      if (effectivePreview === undefined) {
        const { data: existing } = await supabase
          .from("tracks")
          .select("preview_url")
          .eq("id", id)
          .maybeSingle();
        effectivePreview = existing?.preview_url ?? null;
      }
      if (!effectivePreview) {
        return NextResponse.json(
          {
            error:
              "Cannot publish: this track has no preview clip. Generate a preview from the Music Manager before publishing.",
          },
          { status: 400 },
        );
      }
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
