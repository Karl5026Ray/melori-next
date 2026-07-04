import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Profile media for the calling artist: avatar (profile picture) and
// cover_image_url (top-bar / banner photo).
//
// POST  -> returns a signed upload URL scoped to the caller's own folder.
//          Body: { filename: string, slot: "avatar" | "cover" }
// PATCH -> saves an already-uploaded public URL onto the artist row.
//          Body: { publicUrl: string, slot: "avatar" | "cover" }
//
// The artist row is matched by profile_id === the caller's user id, so an
// artist can only ever change their own photos.

const BUCKET = "artist-media";

function slotColumn(slot: unknown): "avatar_url" | "cover_image_url" | null {
  if (slot === "avatar") return "avatar_url";
  if (slot === "cover") return "cover_image_url";
  return null;
}

export async function POST(req: Request) {
  const guard = await requireArtist(req);
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
  const path = `artists/${userId}/${kind}_${Date.now()}_${safeName}`;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    console.error("Artist profile-media signed URL error:", error);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
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
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const { publicUrl, slot } = await req.json().catch(() => ({}) as any);
  const column = slotColumn(slot);
  if (!column) {
    return NextResponse.json({ error: "slot must be 'avatar' or 'cover'" }, { status: 400 });
  }
  if (!publicUrl || typeof publicUrl !== "string") {
    return NextResponse.json({ error: "publicUrl is required" }, { status: 400 });
  }

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("artists")
    .update({ [column]: publicUrl, updated_at: new Date().toISOString() })
    .eq("profile_id", userId)
    .select("id, avatar_url, cover_image_url")
    .single();

  if (error || !data) {
    console.error("Artist profile-media save error:", error);
    return NextResponse.json({ error: "Failed to save photo" }, { status: 500 });
  }

  return NextResponse.json({ artist: data });
}
