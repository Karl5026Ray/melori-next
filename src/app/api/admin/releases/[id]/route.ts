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

// DELETE /api/admin/releases/[id] — DESTRUCTIVE: remove a release row. Its
// tracks and comments cascade automatically (ON DELETE CASCADE). order_items,
// however, references releases with NO ACTION, so a release that has been
// purchased cannot be deleted without orphaning order history — we detect that
// up front and return a clear 409 instead of letting Postgres raise a 500.
//
// DB-row deletion only; storage files (cover art, audio) are left in place.
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
