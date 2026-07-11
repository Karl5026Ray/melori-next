import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

// Bust the public-site caches that surface studio_tracks whenever an admin
// changes one. Cheap no-op if a path isn't referenced yet.
function revalidatePublic(trackId: string) {
  revalidatePath("/");
  revalidatePath("/music");
  revalidatePath(`/music/${trackId}`);
  revalidatePath("/artists");
}

// Extract the storage-relative path from a Supabase public URL:
// `<host>/storage/v1/object/public/<bucket>/<path>` → `<path>`.
function pathFromPublicUrl(url: string | null, bucket: string): string | null {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

// PATCH /api/admin/studio-tracks/[id]
// Owner-of-site management: publish / unpublish and light metadata edits on
// ANY artist's studio track. Reordering/organizing is expressed here via an
// optional numeric `sort_order`.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id || !isUuid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, any> = { updated_at: new Date().toISOString() };

  if (body.status != null) {
    const allowed = ["draft", "scheduled", "published"] as const;
    if (!allowed.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    update.status = body.status;
  }
  if (typeof body.title === "string" && body.title.trim())
    update.title = body.title.trim();
  if (typeof body.artist === "string") update.artist = body.artist.trim();
  if (typeof body.album === "string")
    update.album = body.album.trim() || null;
  if (typeof body.genre === "string")
    update.genre = body.genre.trim() || null;
  if (body.sort_order != null) {
    const n = Number(body.sort_order);
    if (Number.isFinite(n)) update.sort_order = Math.trunc(n);
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_tracks")
    .update(update)
    .eq("id", id)
    .select("id, status")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Update failed" },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  revalidatePublic(id);
  return NextResponse.json({ success: true, track: data });
}

// DELETE /api/admin/studio-tracks/[id]
// Remove any artist's studio track + its storage artifacts. Deletes the DB row
// first (source of truth the public site reads), then best-effort cleans the
// master audio, preview clip, and cover. Storage failures are reported but do
// not fail the request — the row is already gone.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id || !isUuid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: row, error: readError } = await supabase
    .from("studio_tracks")
    .select("file_path, preview_url, cover_url")
    .eq("id", id)
    .single();

  if (readError || !row) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("studio_tracks")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message ?? "Delete failed" },
      { status: 500 },
    );
  }

  const storageErrors: string[] = [];

  if (row.file_path) {
    const { error } = await supabase.storage
      .from("audio-files")
      .remove([row.file_path]);
    if (error) storageErrors.push(`audio-files:${error.message}`);
  }
  const previewPath = pathFromPublicUrl(row.preview_url, "audio-files");
  if (previewPath) {
    const { error } = await supabase.storage
      .from("audio-files")
      .remove([previewPath]);
    if (error) storageErrors.push(`audio-files-preview:${error.message}`);
  }
  const coverPath = pathFromPublicUrl(row.cover_url, "covers");
  if (coverPath) {
    const { error } = await supabase.storage.from("covers").remove([coverPath]);
    if (error) storageErrors.push(`covers:${error.message}`);
  }

  revalidatePublic(id);
  return NextResponse.json({
    success: true,
    storageErrors: storageErrors.length ? storageErrors : undefined,
  });
}
