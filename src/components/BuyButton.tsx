"use client";

import { useState } from "react";

interface BuyButtonProps {
  /** VPS release id — used for whole-album purchases. */
  vpsReleaseId?: number;
  /** VPS track id — used for single-track purchases. Takes precedence. */
  vpsTrackId?: number;
  price: number;
  title?: string;
  /**
   * "default" = full-width primary button (release page).
   * "compact" = small inline button for track rows.
   */
  variant?: "default" | "compact";
}

/**
 * BuyButton — initiates a Stripe Checkout via the VPS purchase API.
 *
 * Contract:
 *   POST /api/purchase/checkout
 *   body: { releaseId } | { trackId }
 *   resp: { checkout_url, amount, item }
 *
 * Next.js rewrites proxy /api/purchase/* -> VPS (160.153.186.249:5000).
 */
export default function BuyButton({
  vpsReleaseId,
  vpsTrackId,
  price,
  title,
  variant = "default",
}: BuyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy() {
    setError(null);
    setLoading(true);
    try {
      const body =
        vpsTrackId != null
          ? { trackId: vpsTrackId }
          : { releaseId: vpsReleaseId };

      if (
        ("releaseId" in body && body.releaseId == null) &&
        ("trackId" in body && body.trackId == null)
      ) {
        throw new Error("BuyButton requires vpsTrackId or vpsReleaseId");
      }

      const res = await fetch("/api/purchase/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const isCompact = variant === "compact";
  const label = loading
    ? "…"
    : isCompact
      ? `$${price.toFixed(2)}`
      : `Buy${title ? ` ${title}` : ""} · $${price.toFixed(2)}`;

  if (isCompact) {
    return (
      <>
        <button
          type="button"
          onClick={handleBuy}
          disabled={loading}
          className="inline-flex shrink-0 items-center justify-center rounded-md border border-brand-primary px-2.5 py-1 text-xs font-semibold text-brand-primary transition-colors hover:bg-brand-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          aria-busy={loading}
          aria-label={
            title
              ? `Buy ${title} for $${price.toFixed(2)}`
              : `Buy for $${price.toFixed(2)}`
          }
        >
          {label}
        </button>
        {error && (
          <span className="sr-only" role="alert">
            {error}
          </span>
        )}
      </>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <button
        type="button"
        onClick={handleBuy}
        disabled={loading}
        className="inline-flex items-center justify-center rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        aria-busy={loading}
      >
        {loading ? "Redirecting…" : label}
      </button>
      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
