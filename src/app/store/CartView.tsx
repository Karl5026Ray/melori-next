"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useCart } from "./CartProvider";
import { formatCents } from "./pricing";

/**
 * Canonical cart + checkout-start UI. Shared by the store cart route
 * (/store/cart) and the top-level /cart and /checkout aliases so there is a
 * single implementation. It reads the cart from CartProvider (localStorage-
 * backed) and POSTs to /api/store/checkout, then redirects IN THE SAME TAB to
 * Stripe Checkout — consistent with the donate, membership, and music flows.
 *
 * `heading` lets the checkout alias read "Checkout" while the cart routes read
 * "Your cart"; the body is otherwise identical (the cart IS the checkout start
 * point, which is why /checkout resolves here).
 */
export default function CartView({ heading = "Your cart" }: { heading?: string }) {
  const { items, updateQuantity, removeItem, subtotal, shipping, total } =
    useCart();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            size: i.size,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-text-secondary">
          Find something you love in the store.
        </p>
        <Link
          href="/store"
          className="mt-6 inline-block rounded-md bg-brand-primary px-6 py-3 font-semibold text-black hover:opacity-90"
        >
          Browse the store
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="mb-8 text-3xl font-bold">{heading}</h1>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {items.map((item) => (
            <div
              key={`${item.productId}-${item.size}`}
              className="flex gap-4 rounded-xl border border-brand-border bg-black/30 p-4"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image_url || "/logo/logo.png"}
                alt={item.name}
                className="h-24 w-24 shrink-0 rounded-lg object-cover"
              />
              <div className="flex flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/store/${item.slug}`}
                      className="font-semibold hover:text-brand-primary"
                    >
                      {item.name}
                    </Link>
                    <p className="text-sm text-text-secondary">
                      Size: {item.size}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId, item.size)}
                    className="text-text-secondary hover:text-red-400"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
                <div className="mt-auto flex items-center justify-between">
                  <div className="inline-flex items-center rounded-md border border-brand-border">
                    <button
                      type="button"
                      onClick={() =>
                        updateQuantity(
                          item.productId,
                          item.size,
                          item.quantity - 1
                        )
                      }
                      className="px-3 py-1 hover:text-brand-primary"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="w-8 text-center">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateQuantity(
                          item.productId,
                          item.size,
                          item.quantity + 1
                        )
                      }
                      className="px-3 py-1 hover:text-brand-primary"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <span className="font-semibold text-brand-primary">
                    {formatCents(item.unitPrice * item.quantity)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <aside className="h-fit rounded-xl border border-brand-border bg-black/30 p-6">
          <h2 className="mb-4 text-lg font-bold">Order summary</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-secondary">Subtotal</dt>
              <dd>{formatCents(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Shipping</dt>
              <dd>{shipping === 0 ? "Free" : formatCents(shipping)}</dd>
            </div>
            <div className="mt-2 flex justify-between border-t border-brand-border pt-3 text-base font-bold">
              <dt>Total</dt>
              <dd className="text-brand-primary">{formatCents(total)}</dd>
            </div>
          </dl>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          <button
            type="button"
            onClick={checkout}
            disabled={loading}
            className="mt-6 w-full rounded-md bg-brand-primary px-6 py-3 font-semibold text-black hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Redirecting…" : "Checkout"}
          </button>
          <Link
            href="/store"
            className="mt-3 block text-center text-sm text-text-secondary hover:text-brand-primary"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </main>
  );
}
