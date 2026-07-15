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

// PATCH /api/admin/releases/[id] — update editable release-level fields so an
// admin has full control over a release: rename it, fix its slug, switch it
// between single/album/ep, set a price, swap the cover art, and publish or
// unpublish it. Only whitelisted fields are accepted; everything else on the
// body is ignored. Track titles and ordering are handled per-track via
// /api/admin/tracks/[id].
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    if (typeof body.title === "string") {
      const t = body.title.trim();
      if (!t) {
        return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
      }
      if (t.length > 200) {
        return NextResponse.json({ error: "title too long (max 200)" }, { status: 400 });
      }
      update.title = t;
    }
    if (typeof body.slug === "string") {
      const s = body.slug.trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(s)) {
        return NextResponse.json(
          { error: "slug may only contain lowercase letters, numbers and hyphens" },
          { status: 400 },
        );
      }
      if (s.length > 200) {
        return NextResponse.json({ error: "slug too long (max 200)" }, { status: 400 });
      }
      update.slug = s;
    }
    if (typeof body.release_type === "string") {
      const rt = body.release_type.trim().toLowerCase();
      const allowed = ["single", "album", "ep"];
      if (!allowed.includes(rt)) {
        return NextResponse.json(
          { error: "release_type must be one of single, album, ep" },
          { status: 400 },
        );
      }
      update.release_type = rt;
    }
    if (body.price != null && body.price !== "") {
      const p = Number(body.price);
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json({ error: "Invalid price" }, { status: 400 });
      }
      update.price = p;
    } else if (body.price === null || body.price === "") {
      update.price = null;
    }
    if (typeof body.cover_art_url === "string") {
      const c = body.cover_art_url.trim();
      if (c.length > 2048) {
        return NextResponse.json({ error: "cover_art_url too long (max 2048)" }, { status: 400 });
      }
      update.cover_art_url = c || null;
    } else if (body.cover_art_url === null) {
      update.cover_art_url = null;
    }
    if (typeof body.is_published === "boolean") {
      update.is_published = body.is_published;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("releases")
      .update(update)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) {
      // A duplicate slug trips the unique constraint — surface a clear 409.
      if ((error as any).code === "23505") {
        return NextResponse.json(
          { error: "That slug is already in use by another release." },
          { status: 409 },
        );
      }
      throw error;
    }
    if (!data) {
      return NextResponse.json({ error: "Release not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`PATCH /api/admin/releases/${params.id} failed:`, err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to update release" },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/releases/[id] — DESTRUCTIVE: remove a release row. Its
// tracks and comments cascade automatically (ON DELETE CASCADE). order_items,
// however, references releases with NO ACTION, so a release that has been
// purchased cannot be deleted without orphaning order history — we detect that
// up front and return a clear 409 instead of letting Postgres raise a 500.
//
// DB-row deletion only; storage files (cover art, audio) are left in place.
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    // Guard: refuse to delete a release that is referenced by order history.
    const { count, error: countErr } = await supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("release_id", id);
    if (countErr) throw countErr;
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "This release has been purchased and is referenced by existing orders, so it can't be deleted. Unpublish it instead to hide it from the site.",
        },
        { status: 409 },
      );
    }
    const { error } = await supabase.from("releases").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`DELETE /api/admin/releases/${params.id} failed:`, err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete release" },
      { status: 500 },
    );
  }
}
