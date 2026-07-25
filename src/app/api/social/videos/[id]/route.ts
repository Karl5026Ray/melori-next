import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isAdmin } from "@/lib/membership";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  archiveAndDeleteSocialVideo,
  DELETABLE_COLUMNS,
} from "@/lib/social-video-delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bust the public video feed cache whenever a video changes. Silent-safe:
// revalidatePath queues an invalidation for the next request; if a path
// doesn't exist yet it's a no-op instead of an error.
function revalidateVideoPaths() {
  revalidatePath("/");
  revalidatePath("/social/video");
  revalidatePath("/video");
  revalidatePath("/social/mirror");
}

// DELETE /api/social/videos/[id] — owner (or admin) deletion of a Mirror post.
//
// The guard is requireAuth, not requireArtist: publishing a native post is open
// to any signed-in member (POST /api/social/videos), so gating the delete on the
// artist tier stranded free-tier members with posts they could see a delete
// button for but never remove. Authorization is the ownership check below plus
// the `user_id = caller` filter on the DELETE itself, which closes the window
// between the read and the write. Admins (profiles.role='admin') may delete any
// post — the same rule the admin panel enforces.
//
// Removal is archive-then-delete (see src/lib/social-video-delete.ts): the row
// is copied into social_videos_archive exactly like the 24h rotation does, then
// dropped from the live table, then its storage objects are swept. YouTube posts
// have no storage object, so only the row moves.
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const supabase = getSupabaseAdmin();
  const callerId = guard.membership.userId!;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  // Fetch first so we know which storage objects to clean up.
  const { data: row, error: fetchError } = await supabase
    .from("social_videos")
    .select(DELETABLE_COLUMNS)
    .eq("id", params.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  if (!callerIsAdmin && row.user_id !== callerId) {
    return NextResponse.json({ error: "Not your video" }, { status: 403 });
  }

  const { error, storageErrors } = await archiveAndDeleteSocialVideo(
    supabase,
    row,
    callerIsAdmin ? null : callerId,
  );
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  revalidateVideoPaths();

  return NextResponse.json({
    success: true,
    storageErrors: storageErrors.length ? storageErrors : undefined,
  });
}
