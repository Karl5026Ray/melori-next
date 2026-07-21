"use client";

import { CartProvider } from "../store/CartProvider";
import CartView from "../store/CartView";

// Top-level /checkout page. The cart IS the checkout starting point (the
// Checkout button POSTs to /api/store/checkout and redirects to Stripe), so
// this renders the same canonical CartView with a "Checkout" heading, wrapped
// in its own localStorage-backed CartProvider. Previously /checkout merely
// redirected to /store/cart; this gives the literal /checkout path a real page.
export default function CheckoutPage() {
  return (
    <CartProvider>
      <CartView heading="Checkout" />
    </CartProvider>
  );
}
