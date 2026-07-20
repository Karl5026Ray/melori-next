import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGINALS_BUCKET = "gallery-originals";
const PREVIEWS_BUCKET = "gallery-previews";

async function loadOwnedImage(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  imageId: string,
  userId: string,
  callerIsAdmin: boolean,
) {
  const { data: image, error } = await supabase
    .from("photo_gallery_images")
    .select(
      "id, gallery_id, storage_key, preview_key, thumbnail_key, photo_galleries!inner(photographer_id)",
    )
    .eq("id", imageId)
    .maybeSingle();
  if (error || !image) return { image: null, forbidden: false };

  const gallery = Array.isArray(image.photo_galleries)
    ? image.photo_galleries[0]
    : image.photo_galleries;
  if (gallery?.photographer_id !== userId && !callerIsAdmin) {
    return { image: null, forbidden: true };
  }
  return { image, forbidden: false };
}

// PATCH /api/studio/gallery/image/[imageId] — owner/admin only. Sets caption,
// for_sale, price_cents, order_index.
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ imageId: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { imageId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { image, forbidden } = await loadOwnedImage(
    supabase,
    imageId,
    userId,
    callerIsAdmin,
  );
  if (forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  let body: {
    caption?: string | null;
    forSale?: boolean;
    priceCents?: number | null;
    orderIndex?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.caption !== undefined) {
    update.caption =
      typeof body.caption === "string" && body.caption.trim()
        ? body.caption.trim()
        : null;
  }
  if (typeof body.orderIndex === "number" && Number.isInteger(body.orderIndex)) {
    update.order_index = body.orderIndex;
  }
  if (typeof body.forSale === "boolean") {
    update.for_sale = body.forSale;
    if (body.forSale) {
      const price =
        typeof body.priceCents === "number" ? body.priceCents : null;
      if (!Number.isInteger(price) || (price ?? 0) <= 0) {
        return NextResponse.json(
          { error: "priceCents must be a positive integer when forSale is true" },
          { status: 400 },
        );
      }
      update.price_cents = price;
    } else {
      update.price_cents = null;
    }
  } else if (body.priceCents !== undefined) {
    const price = typeof body.priceCents === "number" ? body.priceCents : null;
    update.price_cents = Number.isInteger(price) && (price ?? 0) > 0 ? price : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("photo_gallery_images")
    .update(update)
    .eq("id", imageId)
    .select("id, caption, for_sale, price_cents, order_index")
    .single();

  if (error || !updated) {
    console.error("studio/gallery/image PATCH failed", error?.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ image: updated });
}

// DELETE /api/studio/gallery/image/[imageId] — owner/admin only. Removes the
// row plus its storage objects in both buckets (best-effort).
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ imageId: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { imageId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { image, forbidden } = await loadOwnedImage(
    supabase,
    imageId,
    userId,
    callerIsAdmin,
  );
  if (forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  await supabase.storage
    .from(ORIGINALS_BUCKET)
    .remove([image.storage_key as string])
    .catch(() => {});
  await supabase.storage
    .from(PREVIEWS_BUCKET)
    .remove([image.preview_key as string, image.thumbnail_key as string])
    .catch(() => {});

  const { error } = await supabase
    .from("photo_gallery_images")
    .delete()
    .eq("id", imageId);

  if (error) {
    console.error("studio/gallery/image DELETE failed", error.message);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
