"use client";

import CartView from "../CartView";

// Canonical cart route. Renders the shared CartView within the store layout's
// CartProvider. The top-level /cart and /checkout routes render the same view.
export default function CartPage() {
  return <CartView heading="Your cart" />;
}
