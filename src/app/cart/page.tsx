import { redirect } from "next/navigation";

// /cart is an alias for the canonical store cart, which already drives the
// one-off Stripe Checkout (mode: payment) against store_products / orders /
// order_items. Aliasing avoids a duplicate parallel cart implementation.
export default function CartPage() {
  redirect("/store/cart");
}
