import { redirect } from "next/navigation";

// /checkout is an alias into the existing store cart, where checkout starts and
// POSTs to /api/store/checkout (Stripe one-off Checkout). Kept as an alias so
// there is a single, canonical checkout flow rather than a duplicate.
export default function CheckoutPage() {
  redirect("/store/cart");
}
