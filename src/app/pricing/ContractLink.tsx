"use client";

import { useState } from "react";
import { FileText } from "lucide-react";

// Client-side "Review contract (PDF)" link for the pricing/book service cards.
// Fetches a short-lived signed URL from the public
// /api/booking/service-contract/[id] endpoint on click, then opens the PDF in
// a new tab. Kept as its own client component so the pricing page can stay a
// server component.
export default function ContractLink({ serviceId }: { serviceId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/booking/service-contract/${encodeURIComponent(serviceId)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? "Contract unavailable.");
      }
      window.open(body.url as string, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contract unavailable.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={loading}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-brand-border py-2 text-xs font-medium text-text-secondary transition-colors hover:text-brand-primary hover:border-brand-primary/40 disabled:opacity-50"
      >
        <FileText className="h-3.5 w-3.5" />
        {loading ? "Opening…" : "Review contract (PDF)"}
      </button>
      {error && <p className="mt-1 text-center text-[11px] text-red-400">{error}</p>}
    </>
  );
}
