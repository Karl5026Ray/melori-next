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

// Resolve (and lazily create) the caller's linked `artists` row.
// Admins and artist subscribers both hit this route; admins in particular
// often don't have an artists row yet, so uploading a photo used to explode
// with "Failed to save photo". We now upsert on first use.
async function resolveOrCreateArtistRow(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
): Promise<{ id: number } | { error: string }> {
  const existing = await supabase
    .from("artists")
    .select("id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (existing.data?.id) return { id: existing.data.id as number };

  // Look up a display name from profiles to seed the artist row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, full_name, username")
    .eq("id", userId)
    .maybeSingle();

  const seedName =
    (profile as { display_name?: string } | null)?.display_name ||
    (profile as { full_name?: string } | null)?.full_name ||
    (profile as { username?: string } | null)?.username ||
    "MELORI Artist";

  // Build a URL-safe slug and disambiguate with a short user-id suffix so we
  // never collide with an existing artist slug.
  const baseSlug = seedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "artist";
  const slug = `${baseSlug}-${userId.slice(0, 6)}`;

  const insert = await supabase
    .from("artists")
    .insert({
      name: seedName,
      slug,
      profile_id: userId,
      is_published: false,
    })
    .select("id")
    .single();

  if (insert.error || !insert.data?.id) {
    console.error("Artist profile-media auto-create error:", insert.error);
    return { error: insert.error?.message ?? "Could not create artist row" };
  }
  return { id: insert.data.id as number };
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

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const resolved = await resolveOrCreateArtistRow(supabase, userId);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 500 });
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
