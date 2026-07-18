import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { approvedOrigin } from "@/lib/approved-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/gallery/checkout — start a Stripe Checkout for a single digital
// download. Guest checkout is allowed; if the caller is signed in we attach
// their id/email. Price is ALWAYS read server-side — never trust the client.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      { error: "Checkout is not configured yet. Please try again later." },
      { status: 503 },
    );
  }

  let body: { imageId?: string };
  try {
    body = (await req.json()) as { imageId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const imageId = typeof body.imageId === "string" ? body.imageId : null;
  if (!imageId) {
    return NextResponse.json({ error: "imageId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: image, error } = await supabase
    .from("photo_gallery_images")
    .select(
      "id, gallery_id, filename, for_sale, price_cents, photo_galleries!inner(name, slug, is_active)",
    )
    .eq("id", imageId)
    .maybeSingle();

  if (error || !image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  // Supabase returns the embedded relation as an array-typed field.
  const gallery = Array.isArray(image.photo_galleries)
    ? image.photo_galleries[0]
    : image.photo_galleries;

  if (!gallery?.is_active) {
    return NextResponse.json({ error: "Gallery unavailable" }, { status: 404 });
  }
  if (!image.for_sale || !Number.isInteger(image.price_cents) || image.price_cents <= 0) {
    return NextResponse.json(
      { error: "This photo is not for sale." },
      { status: 400 },
    );
  }

  const origin = approvedOrigin(req);

  // Attach buyer identity if signed in (best-effort — guests are allowed).
  const membership = await getRequestMembership(req).catch(() => null);
  const buyerUserId = membership?.userId ?? null;
  const buyerEmail = membership?.email ?? undefined;

  const stripe = new Stripe(secret);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: image.price_cents,
            product_data: {
              name: `${gallery.name} — ${image.filename ?? "Photo"}`,
            },
          },
        },
      ],
      success_url: `${origin}/gallery/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/gallery/${gallery.slug}`,
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      ...(buyerUserId ? { client_reference_id: buyerUserId } : {}),
      metadata: {
        source: "melorimusic.org/gallery",
        image_id: image.id,
        gallery_id: image.gallery_id,
        price_cents: String(image.price_cents),
        ...(buyerUserId ? { user_id: buyerUserId } : {}),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("gallery/checkout error", msg);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 },
    );
  }
}
