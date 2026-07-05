import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREE_SHIPPING_THRESHOLD = 5000; // $50.00 in cents
const SHIPPING_RATE = 500; // $5.00 in cents

interface Item {
  productId?: string;
  quantity?: number;
  size?: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      { error: "Checkout is not configured yet. Please try again later." },
      { status: 503 }
    );
  }

  let body: { items?: Item[] };
  try {
    body = (await req.json()) as { items?: Item[] };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }

  // Validate quantities and collect product ids.
  const requested: { id: string; quantity: number; size: string }[] = [];
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (
      !item.productId ||
      typeof item.productId !== "string" ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity > 99
    ) {
      return NextResponse.json(
        { error: "Invalid cart contents." },
        { status: 400 }
      );
    }
    requested.push({
      id: item.productId,
      quantity,
      size: typeof item.size === "string" ? item.size : "",
    });
  }

  // Fetch authoritative prices/names from the database. Never trust the
  // client for pricing — the cart only supplies ids, quantities, and sizes.
  const supabase = createServiceClient();
  const ids = Array.from(new Set(requested.map((r) => r.id)));
  const { data: products, error: dbError } = await supabase
    .from("store_products")
    .select("id, name, price, sale_price, image_url, is_active")
    .in("id", ids);

  if (dbError) {
    console.error("store/checkout product lookup failed", dbError.message);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 }
    );
  }

  const productMap = new Map(
    (products || []).map((p) => [p.id, p])
  );

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  // Compact, authoritative record of what was purchased, embedded in Stripe
  // metadata so the webhook can fulfill the order without trusting the client.
  const fulfillLines: {
    id: string;
    name: string;
    size: string;
    qty: number;
    unit: number;
  }[] = [];
  let subtotal = 0;

  for (const r of requested) {
    const product = productMap.get(r.id);
    if (!product || product.is_active === false) {
      return NextResponse.json(
        { error: "One or more items are no longer available." },
        { status: 400 }
      );
    }
    const unitPrice =
      typeof product.sale_price === "number" && product.sale_price > 0
        ? product.sale_price
        : product.price;
    if (!Number.isInteger(unitPrice) || unitPrice <= 0) {
      return NextResponse.json(
        { error: "One or more items have an invalid price." },
        { status: 400 }
      );
    }
    subtotal += unitPrice * r.quantity;
    fulfillLines.push({
      id: product.id,
      name: product.name,
      size: r.size,
      qty: r.quantity,
      unit: unitPrice,
    });
    lineItems.push({
      quantity: r.quantity,
      price_data: {
        currency: "usd",
        unit_amount: unitPrice,
        product_data: {
          name: r.size ? `${product.name} (${r.size})` : product.name,
          images: product.image_url ? [product.image_url] : undefined,
        },
      },
    });
  }

  // Pack fulfillment data into metadata. Stripe caps each value at 500 chars,
  // so we chunk the JSON across numbered keys (cart_0, cart_1, ...).
  const cartJson = JSON.stringify(fulfillLines);
  const cartMeta: Record<string, string> = {};
  for (let i = 0, k = 0; i < cartJson.length; i += 480, k++) {
    cartMeta[`cart_${k}`] = cartJson.slice(i, i + 480);
  }

  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_RATE;
  if (shipping > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: shipping,
        product_data: { name: "Shipping" },
      },
    });
  }

  const origin =
    req.headers.get("origin") ||
    (req.headers.get("host")
      ? `https://${req.headers.get("host")}`
      : "https://melorimusic.org");

  // Attach buyer identity if the caller is signed in, so the order can be
  // linked back to their profile in the DB and so Stripe pre-fills the email.
  const membership = await getRequestMembership(req).catch(() => null);
  const buyerUserId = membership?.userId ?? null;
  const buyerEmail = membership?.email ?? undefined;

  const stripe = new Stripe(secret);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: `${origin}/store/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/store/cart`,
      shipping_address_collection: { allowed_countries: ["US", "CA", "GB"] },
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      ...(buyerUserId ? { client_reference_id: buyerUserId } : {}),
      metadata: {
        source: "melorimusic.org/store",
        subtotal_cents: String(subtotal),
        ...(buyerUserId ? { user_id: buyerUserId } : {}),
        ...cartMeta,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("store/checkout error", msg);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 }
    );
  }
}
