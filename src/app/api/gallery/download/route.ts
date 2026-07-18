import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGINALS_BUCKET = "gallery-originals"; // private
const SIGNED_TTL_SECONDS = 300; // 5 minutes

// GET /api/gallery/download?session_id=... — hand back a short-lived signed URL
// to the CLEAN original after payment. The webhook records the paid purchase
// row; we verify it exists (status 'paid') before signing the private object.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  const { data: purchase, error } = await supabase
    .from("photo_gallery_purchases")
    .select("id, image_id, status")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("gallery/download purchase lookup failed", error.message);
    return NextResponse.json(
      { error: "Could not verify purchase" },
      { status: 500 },
    );
  }

  // No row yet: webhook may not have landed. 402 tells the client to retry.
  if (!purchase || purchase.status !== "paid") {
    return NextResponse.json(
      { error: "Payment not confirmed yet. Please try again in a moment." },
      { status: 402 },
    );
  }

  const { data: image } = await supabase
    .from("photo_gallery_images")
    .select("id, storage_key, filename")
    .eq("id", purchase.image_id)
    .maybeSingle();

  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .createSignedUrl(image.storage_key, SIGNED_TTL_SECONDS, {
      download: image.filename ?? true,
    });

  if (signErr || !signed?.signedUrl) {
    console.error("gallery/download sign failed", signErr?.message);
    return NextResponse.json(
      { error: "Could not prepare download" },
      { status: 500 },
    );
  }

  // Best-effort download counter.
  await supabase.rpc("increment_gallery_download_count", {
    p_image_id: image.id,
  }).then(
    () => {},
    () => {},
  );

  return NextResponse.json({ url: signed.signedUrl, filename: image.filename });
}
