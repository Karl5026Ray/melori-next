"use client";

import { useState } from "react";

interface BuyButtonProps {
  /** Supabase release id — used for whole-album purchases. */
  releaseId?: number;
  /** Supabase track id — used for single-track purchases. Takes precedence. */
  trackId?: number;
  /** @deprecated legacy alias for releaseId (VPS era) */
  vpsReleaseId?: number;
  /** @deprecated legacy alias for trackId (VPS era) */
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
 * BuyButton — initiates a Stripe Checkout via the in-repo music purchase API.
 *
 * Contract:
 *   POST /api/music/checkout
 *   body: { releaseId } | { trackId }
 *   resp: { url }   (also returns { checkout_url } for backwards-compat)
 *
 * This is a real Next.js route handler backed by Stripe + Supabase. It replaces
 * the old /api/purchase/checkout path that proxied to the legacy VPS (whose
 * Stripe key was expired and whose release ids no longer matched Supabase).
 */
export default function BuyButton({
  releaseId,
  trackId,
  vpsReleaseId,
  vpsTrackId,
  price,
  title,
  variant = "default",
}: BuyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefer the canonical Supabase ids; fall back to the legacy vps* aliases so
  // any un-migrated caller keeps working (the ids are the same Supabase ids).
  const effectiveTrackId = trackId ?? vpsTrackId;
  const effectiveReleaseId = releaseId ?? vpsReleaseId;

  async function handleBuy() {
    setError(null);
    setLoading(true);
    try {
      const body =
        effectiveTrackId != null
          ? { trackId: effectiveTrackId }
          : { releaseId: effectiveReleaseId };

      if (
        ("releaseId" in body && body.releaseId == null) &&
        ("trackId" in body && body.trackId == null)
      ) {
        throw new Error("BuyButton requires a trackId or releaseId");
      }

      const res = await fetch("/api/music/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        checkout_url?: string;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || `Checkout failed (${res.status}).`);
      }

      const checkoutUrl = data.url || data.checkout_url;
      if (!checkoutUrl) {
        throw new Error("Checkout response missing the redirect URL.");
      }

      window.location.href = checkoutUrl;
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
