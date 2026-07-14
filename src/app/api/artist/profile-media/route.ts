import { NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Universal profile media for ANY signed-in user: avatar (profile picture) and
// banner (top-bar / cover photo). Previously this was artist-only and wrote to
// the `artists` table, so Superfan/free users had no banner at all. It now
// writes to the shared `profiles` table (avatar_url / banner_url) so every
// member can personalise their profile — a low-friction growth hook that fits
// the Option 1 freemium model.
//
// POST  -> returns a signed upload URL scoped to the caller's own folder.
//          Body: { filename: string, slot: "avatar" | "cover" }
// PATCH -> saves an already-uploaded public URL onto the caller's profile row.
//          Body: { publicUrl: string, slot: "avatar" | "cover" }
//
// The profile row is matched by id === the caller's user id, so a user can
// only ever change their own photos.

// We store profile media in the existing `covers` bucket, which already exists
// and is publicly readable (used by the admin cover-art and social avatar
// flows). The dedicated `artist-media` bucket was never provisioned in prod.
const BUCKET = "covers";

// Map the client slot to the profiles column. "cover" is the banner photo.
function slotColumn(slot: unknown): "avatar_url" | "banner_url" | null {
  if (slot === "avatar") return "avatar_url";
  if (slot === "cover") return "banner_url";
  return null;
}

// GET -> returns the caller's current avatar_url / banner_url so the editor can
// preview what's already saved. Shape keeps the legacy `artist` key + a
// cover_image_url alias so existing clients keep working during rollout.
export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, avatar_url, banner_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Profile-media GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const media = data ?? { id: userId, avatar_url: null, banner_url: null };
  return NextResponse.json({
    media,
    // Back-compat aliases for older Studio client builds still in flight.
    artist: {
      id: media.id,
      avatar_url: media.avatar_url,
      cover_image_url: media.banner_url,
    },
  });
}

export async function POST(req: Request) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const { filename, slot } = await req.json().catch(() => ({}) as any);
  const column = slotColumn(slot);
  if (!column) {
    return NextResponse.json({ error: "slot must be 'avatar' or 'cover'" }, { status: 400 });
  }
  if (!filename || typeof filename !== "string") {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }

  const userId = guard.membership.userId!;
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const kind = slot === "avatar" ? "avatar" : "cover";
  // Keep the existing `artists/<userId>/...` path prefix so the PATCH
  // ownership check and any already-uploaded assets stay valid.
  const path = `artists/${userId}/${kind}_${Date.now()}_${safeName}`;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    console.error("Profile-media signed URL error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to create upload URL" },
      { status: 500 },
    );
  }

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({
    signedUrl: data.signedUrl,
    publicUrl: publicData.publicUrl,
    path,
    bucket: BUCKET,
    slot,
  });
}

export async function PATCH(req: Request) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const { publicUrl, slot } = await req.json().catch(() => ({}) as any);
  const column = slotColumn(slot);
  if (!column) {
    return NextResponse.json({ error: "slot must be 'avatar' or 'cover'" }, { status: 400 });
  }
  if (!publicUrl || typeof publicUrl !== "string") {
    return NextResponse.json({ error: "publicUrl is required" }, { status: 400 });
  }
  if (publicUrl.length > 2048 || publicUrl.includes("..")) {
    return NextResponse.json({ error: "Invalid publicUrl" }, { status: 400 });
  }

  // The client PATCHes back a public URL it just received from our own POST
  // handler. Reject anything that doesn't reference the caller's own storage
  // folder so a caller can't smuggle an arbitrary (e.g. phishing) image URL
  // onto their public profile.
  const userId = guard.membership.userId!;
  const expectedPathFragment = `/storage/v1/object/public/${BUCKET}/artists/${userId}/`;
  if (!publicUrl.includes(expectedPathFragment)) {
    return NextResponse.json(
      { error: "publicUrl must reference the caller's storage folder" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .update({ [column]: publicUrl, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select("id, avatar_url, banner_url")
    .single();

  if (error || !data) {
    console.error("Profile-media save error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to save photo" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    media: data,
    artist: {
      id: data.id,
      avatar_url: data.avatar_url,
      cover_image_url: data.banner_url,
    },
  });
}
