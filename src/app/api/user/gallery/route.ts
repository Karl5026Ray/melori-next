import { NextResponse } from "next/server";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Personal photo gallery for superfan/artist accounts (max 12 photos).
// Images live in the public `covers` bucket under gallery/{userId}/… .
// All DB access here uses the service-role client (bypasses RLS); the
// requireSuperfan guard restricts every method to superfan-or-better callers.

const BUCKET = "covers";
const MAX_PHOTOS = 12;

// True when the query error means the table hasn't been created yet, so reads
// can degrade to an empty gallery instead of a 500 (migration 018 pending).
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /relation .*profile_gallery.* does not exist/i.test(error.message ?? "")
  );
}

// Extract the object path inside the `covers` bucket from a public URL so we
// can best-effort delete the stored file. Returns null if it doesn't reference
// this bucket.
function storagePathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export async function GET(req: Request) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profile_gallery")
    .select("id, image_url, sort_order")
    .eq("profile_id", userId)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ photos: [] });
    console.error("Gallery GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ photos: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;

  const { filename, contentType } = await req.json().catch(() => ({}) as any);
  if (!filename || typeof filename !== "string") {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }
  if (contentType && typeof contentType === "string" && !contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads are allowed" }, { status: 400 });
  }

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const { count, error: countError } = await supabase
    .from("profile_gallery")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", userId);
  if (countError && !isMissingTable(countError)) {
    console.error("Gallery count error:", countError);
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Gallery is full (max ${MAX_PHOTOS} photos).` },
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
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;

  const body = await req.json().catch(() => ({}) as any);
  const userId = guard.membership.userId!;
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
  if ((count ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Gallery is full (max ${MAX_PHOTOS} photos).` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("profile_gallery")
    .insert({ profile_id: userId, image_url: publicUrl, sort_order: count ?? 0 })
    .select("id, image_url, sort_order")
    .single();

  if (error || !data) {
    console.error("Gallery insert error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to save photo" },
      { status: 500 },
    );
  }

  return NextResponse.json({ photo: data });
}

export async function DELETE(req: Request) {
  const guard = await requireSuperfan(req);
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
