"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Fallback for Stripe Payment Links whose redirect still points at the homepage
// (`/?success=superfan|artist`) instead of `/welcome`. Without a session_id we
// can't verify the purchase against Stripe here, so we simply surface a prompt
// guiding the buyer to create/activate their account. The proper flow (with
// server-side verification) lives at /welcome once the Payment Link redirects
// are updated.
export default function SuccessBanner() {
  const params = useSearchParams();
  const success = params.get("success");
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (success !== "superfan" && success !== "artist") return null;

  const label = success === "artist" ? "Artist" : "Superfan";

  return (
    <div className="max-w-6xl mx-auto px-6 pt-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-brand-primary/40 bg-brand-primary/10 px-5 py-4">
        <div className="flex-1">
          <p className="font-semibold">Payment received — thank you!</p>
          <p className="text-sm text-text-secondary">
            Create your account to activate your {label} membership.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/social/auth"
            className="inline-block px-5 py-2.5 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white text-sm"
          >
            Set up account
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="text-text-secondary hover:text-text-primary text-sm"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
