import { NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { tierOf } from "@/lib/membership";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { moderateImage, statusForDecision } from "@/lib/moderation";
import { recordModeration } from "@/lib/moderation-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Personal media gallery for EVERY signed-in account (photos or vertical
// videos), editable straight from the profile page. Slot limits are tier-based
// so free accounts get a taste and paid tiers get room to express a brand:
//   free      -> 4 slots
//   superfan  -> 20 slots
//   artist    -> 20 slots
// Media lives in the public `covers` bucket under gallery/{userId}/… .
// All DB access uses the service-role client (bypasses RLS); requireAuth
// restricts every method to the signed-in owner acting on their own rows.

const BUCKET = "covers";

// Per-tier slot allowance. Photos and vertical videos share the same pool.
function maxSlotsFor(profile: Parameters<typeof tierOf>[0]): number {
  const tier = tierOf(profile); // "free" | "superfan" | "artist"
  if (tier === "superfan" || tier === "artist") return 20;
  return 4; // free
}

// True when the query error means the table hasn't been created yet, so reads
// can degrade to an empty gallery instead of a 500.
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /relation .*profile_gallery.* does not exist/i.test(error.message ?? "")
  );
}

// Extract the object path inside the `covers` bucket from a public URL so we
// can best-effort delete the stored file.
function storagePathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const max = maxSlotsFor(guard.membership.profile);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profile_gallery")
    .select("id, image_url, media_type, sort_order")
    .eq("profile_id", userId)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ photos: [], max, used: 0 });
    }
    console.error("Gallery GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    photos: data ?? [],
    max,
    used: (data ?? []).length,
  });
}

export async function POST(req: Request) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const { filename, contentType } = await req.json().catch(() => ({}) as any);
  if (!filename || typeof filename !== "string") {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }
  // Accept images OR videos (vertical clips). Anything else is rejected.
  const isImage =
    typeof contentType === "string" && contentType.startsWith("image/");
  const isVideo =
    typeof contentType === "string" && contentType.startsWith("video/");
  if (contentType && !isImage && !isVideo) {
    return NextResponse.json(
      { error: "Only image or video uploads are allowed" },
      { status: 400 },
    );
  }

  const userId = guard.membership.userId!;
  const max = maxSlotsFor(guard.membership.profile);
  const supabase = getSupabaseAdmin();

  const { count, error: countError } = await supabase
    .from("profile_gallery")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", userId);
  if (countError && !isMissingTable(countError)) {
    console.error("Gallery count error:", countError);
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) >= max) {
    return NextResponse.json(
      { error: `Your gallery is full (max ${max} slots for your plan).` },
      { status: 400 },
    );
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `gallery/${userId}/${Date.now()}_${safeName}`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    console.error("Gallery signed URL error:", error);
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
  });
}

export async function PATCH(req: Request) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const body = await req.json().catch(() => ({}) as any);
  const userId = guard.membership.userId!;
  const max = maxSlotsFor(guard.membership.profile);
  const supabase = getSupabaseAdmin();

  // Reorder mode: persist a new sort_order for the caller's own rows.
  if (Array.isArray(body?.order)) {
    const ids: string[] = body.order.filter((x: unknown) => typeof x === "string");
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase
        .from("profile_gallery")
        .update({ sort_order: i })
        .eq("id", ids[i])
        .eq("profile_id", userId);
      if (error) {
        console.error("Gallery reorder error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // Insert mode: add a new row for an already-uploaded public URL.
  const publicUrl = String(body?.publicUrl ?? "").trim();
  const mediaType = body?.media_type === "video" ? "video" : "photo";
  if (!publicUrl) {
    return NextResponse.json({ error: "publicUrl is required" }, { status: 400 });
  }
  if (publicUrl.length > 2048 || publicUrl.includes("..")) {
    return NextResponse.json({ error: "Invalid publicUrl" }, { status: 400 });
  }
  // Only accept URLs that came from this caller's own gallery folder.
  const expected = `/storage/v1/object/public/${BUCKET}/gallery/${userId}/`;
  if (!publicUrl.includes(expected)) {
    return NextResponse.json(
      { error: "publicUrl must reference the caller's gallery folder" },
      { status: 400 },
    );
  }

  const { count } = await supabase
    .from("profile_gallery")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", userId);
  if ((count ?? 0) >= max) {
    return NextResponse.json(
      { error: `Your gallery is full (max ${max} slots for your plan).` },
      { status: 400 },
    );
  }

  // --- Content moderation -------------------------------------------------
  // Photos are screened by OpenAI image moderation before they go public.
  //   * Pornography / nudity  -> REFUSED outright + storage object deleted
  //     (owner policy: not permitted, never public).
  //   * Explicit / borderline -> inserted but moderation_status='flagged'
  //     (stays visible; queued for admin review).
  // Videos can't be frame-inspected in the serverless runtime, so they enter
  // as 'pending_review' (visible but always eyed by an admin).
  let moderationStatus = "clean";
  let moderationReason: string | null = null;
  if (mediaType === "photo") {
    const mod = await moderateImage(publicUrl);
    if (mod.decision === "quarantine") {
      // Purge the offending file so it is never reachable.
      const path = storagePathFromUrl(publicUrl);
      if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
      await recordModeration({
        contentType: "gallery",
        authorId: userId,
        result: mod,
        mediaUrl: publicUrl,
      });
      return NextResponse.json(
        {
          error:
            "This image can't be added. It appears to contain explicit sexual content, which isn't permitted.",
        },
        { status: 422 },
      );
    }
    moderationStatus = statusForDecision(mod.decision);
    moderationReason = mod.reason;
  } else {
    // video
    moderationStatus = "pending_review";
    moderationReason = "Video pending automated frame review";
  }

  const { data, error } = await supabase
    .from("profile_gallery")
    .insert({
      profile_id: userId,
      image_url: publicUrl,
      media_type: mediaType,
      sort_order: count ?? 0,
      moderation_status: moderationStatus,
      moderation_reason: moderationReason,
    })
    .select("id, image_url, media_type, sort_order")
    .single();

  if (error || !data) {
    console.error("Gallery insert error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to save media" },
      { status: 500 },
    );
  }

  // Queue flagged / pending items for admin review (best-effort).
  if (moderationStatus === "flagged" || moderationStatus === "pending_review") {
    await recordModeration({
      contentType: mediaType === "video" ? "video" : "gallery",
      contentId: data.id,
      authorId: userId,
      result: {
        decision: moderationStatus === "flagged" ? "flag" : "clean",
        reason: moderationReason,
        categories: null,
        degraded: false,
      },
      mediaUrl: publicUrl,
    });
  }

  return NextResponse.json({ photo: data });
}

export async function DELETE(req: Request) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const { id } = await req.json().catch(() => ({}) as any);
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const { data: row } = await supabase
    .from("profile_gallery")
    .select("id, image_url")
    .eq("id", id)
    .eq("profile_id", userId)
    .maybeSingle();

  const { error } = await supabase
    .from("profile_gallery")
    .delete()
    .eq("id", id)
    .eq("profile_id", userId);

  if (error) {
    console.error("Gallery delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort storage cleanup — never fail the request on this.
  const imageUrl = (row as { image_url?: string } | null)?.image_url;
  if (imageUrl) {
    const path = storagePathFromUrl(imageUrl);
    if (path) {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
