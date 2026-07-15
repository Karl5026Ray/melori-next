import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";
import { revalidatePath, revalidateTag } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  const ADMIN_SECRET = getAdminSecret();
  if (!token || !ADMIN_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

// PATCH /api/admin/moderation/tracks/[id]
//   { moderation_status: 'clean'|'pending_review'|'flagged'|'removed', reason?: string }
//
// Manual moderation lever. Only touches moderation_status (never is_published),
// so an artist's published state is preserved and a takedown is one-field reversible.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { moderation_status, reason } = await req.json().catch(() => (({}) as any));
  const allowed = ["clean", "pending_review", "flagged", "removed"];
  if (!allowed.includes(moderation_status)) {
    return NextResponse.json({ error: "Invalid moderation_status" }, { status: 400 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: track, error } = await supabase
    .from("tracks")
    .update({
      moderation_status,
      moderation_reason: typeof reason === "string" ? reason.slice(0, 2000) : null,
      moderated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, release_id, moderation_status, is_published, releases(artist_id)")
    .single();

  if (error || !track) {
    console.error("Manual moderation failed:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    action: "track_moderation_manual",
    table_name: "tracks",
    record_id: id,
    new_data: { moderation_status, reason: reason ?? null },
  });

  // @ts-expect-error nested select shape
  const artistId: number | null = track?.releases?.artist_id ?? null;
  if (artistId) revalidateTag(`artist-${artistId}`, "max");
  revalidatePath("/browse");
  revalidatePath("/");

  return NextResponse.json({ ok: true, track });
}
