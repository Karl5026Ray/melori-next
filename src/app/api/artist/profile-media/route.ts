import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ensureArtistRow } from "@/lib/artist";

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

// We store profile media in the existing `covers` bucket. The dedicated
// `artist-media` bucket was never provisioned in production, so uploads to it
// silently failed for admins who don't happen to have one created. `covers` is
// already used by the admin cover-art flow AND the social avatar flow, so we
// know it exists and is publicly readable.
const BUCKET = "covers";

function slotColumn(slot: unknown): "avatar_url" | "cover_image_url" | null {
  if (slot === "avatar") return "avatar_url";
  if (slot === "cover") return "cover_image_url";
  return null;
}

// GET -> returns the caller artist's current avatar_url / cover_image_url so
// the Studio page can preview what's already saved.
export async function GET(req: Request) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("artists")
    .select("id, avatar_url, cover_image_url")
    .eq("profile_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Artist profile-media GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    artist: data ?? { id: null, avatar_url: null, cover_image_url: null },
  });
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
  if (publicUrl.length > 2048 || publicUrl.includes("..")) {
    return NextResponse.json({ error: "Invalid publicUrl" }, { status: 400 });
  }

  // The client PATCHes back a public URL it just received from our own
  // POST handler. Reject anything that doesn't look like it came from our
  // Supabase Storage `covers` bucket so a caller can't smuggle an arbitrary
  // (e.g. phishing) image URL onto their public artist profile.
  const userId = guard.membership.userId!;
  const expectedPathFragment = `/storage/v1/object/public/${BUCKET}/artists/${userId}/`;
  if (!publicUrl.includes(expectedPathFragment)) {
    return NextResponse.json(
      { error: "publicUrl must reference the caller's storage folder" },
      { status: 400 },
    );
  }
  const supabase = getSupabaseAdmin();

  const resolved = await ensureArtistRow(userId, {}, supabase);
  if (!resolved.id) {
    return NextResponse.json(
      { error: resolved.error ?? "Could not create artist row" },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from("artists")
    .update({ [column]: publicUrl, updated_at: new Date().toISOString() })
    .eq("id", resolved.id)
    .select("id, avatar_url, cover_image_url")
    .single();

  if (error || !data) {
    console.error("Artist profile-media save error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to save photo" },
      { status: 500 },
    );
  }

  return NextResponse.json({ artist: data });
}
