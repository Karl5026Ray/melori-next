"use client";

import { CartProvider } from "../store/CartProvider";
import CartView from "../store/CartView";

// Top-level /cart page. Renders the same canonical CartView as /store/cart,
// wrapped in its own CartProvider. CartProvider is localStorage-backed
// (melori_store_cart), so the cart contents stay in sync with the store no
// matter which route the visitor lands on. Previously /cart merely redirected
// to /store/cart; this gives the literal /cart path a real page.
export default function CartPage() {
  return (
    <CartProvider>
      <CartView heading="Your cart" />
    </CartProvider>
  );
}
