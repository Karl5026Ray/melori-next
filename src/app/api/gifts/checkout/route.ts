import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { approvedOrigin } from "@/lib/approved-origin";
import { COIN_PACK_SOURCE } from "@/lib/gifting";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Checkout is not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const packId = typeof body.pack_id === "string" ? body.pack_id.trim() : "";
  const spaceId = typeof body.space_id === "string" ? body.space_id.trim() : "";
  if (!isUuid(packId) || !isUuid(spaceId)) {
    return NextResponse.json({ error: "Invalid coin checkout request" }, { status: 400 });
  }

  const { data: pack, error } = await getSupabaseAdmin()
    .from("coin_packs")
    .select("id, name, coin_amount, price_usd_cents")
    .eq("id", packId)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    console.error("coin pack lookup failed", error);
    return NextResponse.json({ error: "Could not start checkout" }, { status: 500 });
  }
  if (!pack) return NextResponse.json({ error: "Coin pack not found" }, { status: 404 });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pack.price_usd_cents,
          product_data: {
            name: `${pack.name} — ${pack.coin_amount.toLocaleString()} Melori Coins`,
          },
        },
      }],
      // Return the fan to the Concert they were watching rather than dropping
      // them on discovery after hosted Checkout.
      success_url: `${approvedOrigin(req)}/social/spaces/${spaceId}?coins=success`,
      cancel_url: `${approvedOrigin(req)}/social/spaces/${spaceId}?coins=cancelled`,
      ...(guard.membership.email ? { customer_email: guard.membership.email } : {}),
      client_reference_id: guard.membership.userId!,
      metadata: {
        source: COIN_PACK_SOURCE,
        pack_id: pack.id,
        user_id: guard.membership.userId!,
        space_id: spaceId,
      },
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("coin pack checkout failed", err);
    return NextResponse.json({ error: "Could not start checkout" }, { status: 500 });
  }
}
