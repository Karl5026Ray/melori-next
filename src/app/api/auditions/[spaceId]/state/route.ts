import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { directorOnly, isContextFailure, loadAuditionContext } from "@/lib/auditions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auditions/[spaceId]/state — the director opens a script or turns
// the page. Readers follow by polling the room GET.
// Body: { script_file_id?: uuid | null, page?: number }
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const ctx = await loadAuditionContext((await params).spaceId, guard.membership.userId!);
  if (isContextFailure(ctx)) return ctx;
  const notDirector = directorOnly(ctx);
  if (notDirector) return notDirector;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const supabase = getSupabaseAdmin();
  const update: Record<string, unknown> = {
    space_id: ctx.room.id,
    updated_at: new Date().toISOString(),
  };

  if (body.script_file_id !== undefined) {
    if (body.script_file_id === null) {
      update.script_file_id = null;
    } else {
      if (!isUuid(body.script_file_id)) {
        return NextResponse.json({ error: "Invalid script" }, { status: 400 });
      }
      const { data: file } = await supabase
        .from("audition_files")
        .select("id")
        .eq("id", body.script_file_id)
        .eq("space_id", ctx.room.id)
        .eq("kind", "script")
        .maybeSingle();
      if (!file) return NextResponse.json({ error: "Script not found" }, { status: 404 });
      update.script_file_id = file.id;
      update.page = 1;
    }
  }
  if (body.page !== undefined) {
    const page = Number(body.page);
    if (!Number.isInteger(page) || page < 1 || page > 2000) {
      return NextResponse.json({ error: "Invalid page" }, { status: 400 });
    }
    update.page = page;
  }

  const { data, error } = await supabase
    .from("audition_room_state")
    .upsert(update, { onConflict: "space_id" })
    .select("script_file_id, page, updated_at")
    .single();
  if (error) return NextResponse.json({ error: "Could not update the script" }, { status: 500 });
  return NextResponse.json({ state: data });
}
