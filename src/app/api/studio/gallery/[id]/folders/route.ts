import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/studio/gallery/[id]/folders — owner/admin only.
// Body: { name } → { folder: { id, name } }
// Adds a new folder (category) at the end of the gallery, so a new kind of
// work (say "Fashion") can be started from the upload picker. An existing
// folder with the same name (any case) is returned instead of duplicated.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);
  const { id: galleryId } = await props.params;

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const name = String(body?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) {
    return NextResponse.json(
      { error: "Folder name must be 1–60 characters." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: gallery } = await supabase
    .from("photo_galleries")
    .select("id, photographer_id")
    .eq("id", galleryId)
    .maybeSingle();
  if (!gallery) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }
  if (gallery.photographer_id !== userId && !callerIsAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: existing } = await supabase
    .from("photo_gallery_folders")
    .select("id, name, order_index")
    .eq("gallery_id", galleryId)
    .order("order_index", { ascending: true });
  const same = (existing ?? []).find(
    (f) => String(f.name).toLowerCase() === name.toLowerCase(),
  );
  if (same) {
    return NextResponse.json({ folder: { id: same.id, name: same.name } });
  }

  const nextOrder =
    Math.max(-1, ...(existing ?? []).map((f) => Number(f.order_index) || 0)) + 1;
  const { data: folder, error } = await supabase
    .from("photo_gallery_folders")
    .insert({ gallery_id: galleryId, name, order_index: nextOrder })
    .select("id, name")
    .single();
  if (error || !folder) {
    console.error("studio/gallery folder create failed", error?.message);
    return NextResponse.json({ error: "Couldn't create folder" }, { status: 500 });
  }
  return NextResponse.json({ folder });
}
