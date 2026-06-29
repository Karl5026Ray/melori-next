"use client";

import { useState } from "react";

interface BuyButtonProps {
  vpsReleaseId: number;
  price: number;
  title?: string;
}

/**
 * BuyButton — initiates a Stripe Checkout via the VPS purchase API.
 *
 * Contract:
 *   POST /api/purchase/checkout
 *   body: { releaseId: <number> }
 *   resp: { checkout_url, amount, item }
 *
 * Next.js rewrites proxy /api/purchase/* -> VPS (160.153.186.249:5000).
 */
export default function BuyButton({ vpsReleaseId, price, title }: BuyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/purchase/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId: vpsReleaseId }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Checkout failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
        );
      }

      const data = (await res.json()) as { checkout_url?: string };
      if (!data.checkout_url) {
        throw new Error("Checkout response missing checkout_url");
      }

      window.location.href = data.checkout_url;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      setLoading(false);
    }
  }

  const label = loading
    ? "Redirecting…"
    : `Buy${title ? ` ${title}` : ""} · $${price.toFixed(2)}`;

  return (
    <div className="mt-4 flex flex-col gap-2">
      <button
        type="button"
        onClick={handleBuy}
        disabled={loading}
        className="inline-flex items-center justify-center rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        aria-busy={loading}
      >
        {label}
      </button>
      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
