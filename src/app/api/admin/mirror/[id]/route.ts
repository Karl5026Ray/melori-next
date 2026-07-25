import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  requireAdmin,
  isAdminGuardFailure,
  logAdminAction,
} from "@/lib/admin-panel";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  archiveAndDeleteSocialVideo,
  DELETABLE_COLUMNS,
} from "@/lib/social-video-delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/admin/mirror/[id] — remove ANY Mirror post.
//
// Same archive-then-delete path as the owner route, but gated on
// profiles.role='admin' (requireAdmin) with no ownership scope, and it writes an
// admin_activity_logs row so a takedown is attributable.
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  const supabase = getSupabaseAdmin();

  const { data: row, error: fetchError } = await supabase
    .from("social_videos")
    .select(DELETABLE_COLUMNS)
    .eq("id", params.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const { error, storageErrors } = await archiveAndDeleteSocialVideo(
    supabase,
    row,
    null,
  );
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  await logAdminAction(admin, {
    action: "delete",
    targetType: "mirror_post",
    targetId: row.id,
    details: { author_id: row.user_id, source: row.source ?? "upload" },
  });

  revalidatePath("/");
  revalidatePath("/social/video");
  revalidatePath("/social/mirror");

  return NextResponse.json({
    success: true,
    storageErrors: storageErrors.length ? storageErrors : undefined,
  });
}
