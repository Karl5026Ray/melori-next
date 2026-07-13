"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export interface Tier {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  features: string[];
  color: string;
  is_popular: boolean;
  display_order: number;
  stripe_payment_link_monthly: string | null;
  stripe_payment_link_yearly: string | null;
}

function formatPrice(n: number): string {
  if (n === 0) return "Free";
  return `$${Number(n).toFixed(2)}`;
}

export default function TierGrid({ tiers }: { tiers: Tier[] }) {
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  // Auth awareness: we want a paid membership to link to a Melori account.
  // null = still checking; string = logged-in email; "" = logged out.
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // When a logged-out user taps a paid tier, we hold the intended destination
  // and show a prompt to create/sign in first (so the sub links to them).
  const [pendingLink, setPendingLink] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUserEmail(data.session?.user?.email ?? "");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (active) setUserEmail(session?.user?.email ?? "");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Pre-fill the buyer's email at Stripe so the membership webhook can link the
  // subscription back to their profile (it matches by customer email).
  function withEmail(link: string): string {
    if (!userEmail) return link;
    const sep = link.includes("?") ? "&" : "?";
    return `${link}${sep}prefilled_email=${encodeURIComponent(userEmail)}`;
  }

  function handlePaidClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    link: string,
  ) {
    // Logged out -> intercept and prompt account creation first.
    if (userEmail === "") {
      e.preventDefault();
      setPendingLink(link);
    }
    // Logged in (or still checking) -> let the link proceed (with email).
  }

  const anyYearly = tiers.some((t) => Number(t.price_yearly) > 0);

  return (
    <div>
      {anyYearly && (
        <div className="flex justify-center mb-10">
          <div
            className="inline-flex rounded-full border border-brand-border bg-white/5 p-1"
            role="tablist"
            aria-label="Billing period"
          >
            <button
              type="button"
              role="tab"
              aria-selected={billing === "monthly"}
              onClick={() => setBilling("monthly")}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                billing === "monthly"
                  ? "bg-brand-primary text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={billing === "yearly"}
              onClick={() => setBilling("yearly")}
              className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                billing === "yearly"
                  ? "bg-brand-primary text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Yearly
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  billing === "yearly"
                    ? "bg-white/25 text-white"
                    : "bg-brand-primary/15 text-brand-primary"
                }`}
              >
                Save ~17%
              </span>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiers.map((tier) => {
          const monthly = Number(tier.price_monthly);
          const yearly = Number(tier.price_yearly);
          const isFree = monthly === 0 && yearly === 0;
          const showYearly = billing === "yearly" && yearly > 0;
          const displayPrice = showYearly ? yearly : monthly;
          const periodLabel = showYearly ? "/year" : "/month";
          const yearlySavings =
            monthly > 0 && yearly > 0
              ? Math.round((1 - yearly / (monthly * 12)) * 100)
              : 0;

          const link = showYearly
            ? tier.stripe_payment_link_yearly
            : tier.stripe_payment_link_monthly;

          return (
            <article
              key={tier.id}
              className={`relative flex flex-col p-8 rounded-2xl border bg-white/5 ${
                tier.is_popular
                  ? "border-brand-primary shadow-lg md:scale-105"
                  : "border-brand-border"
              }`}
            >
              {tier.is_popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand-primary text-white text-xs font-semibold uppercase tracking-wide">
                  Most Popular
                </div>
              )}

              <h3 className="text-2xl font-bold">{tier.name}</h3>
              {tier.tagline && (
                <p className="mt-1 text-sm text-text-secondary">
                  {tier.tagline}
                </p>
              )}

              <div className="mt-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">
                    {formatPrice(displayPrice)}
                  </span>
                  {displayPrice > 0 && (
                    <span className="text-text-secondary">{periodLabel}</span>
                  )}
                </div>
                {!showYearly && yearly > 0 && (
                  <p className="mt-1 text-sm text-text-secondary">
                    or ${yearly.toFixed(2)}/year
                    {yearlySavings > 0 && (
                      <span className="ml-2 rounded-full bg-brand-primary/15 px-2 py-0.5 text-xs font-semibold text-brand-primary">
                        Save {yearlySavings}% yearly
                      </span>
                    )}
                  </p>
                )}
                {showYearly && monthly > 0 && yearlySavings > 0 && (
                  <p className="mt-1 text-sm text-brand-primary font-medium">
                    save {yearlySavings}% vs monthly
                  </p>
                )}
              </div>

              {tier.description && (
                <p className="mt-4 text-sm text-text-secondary leading-relaxed">
                  {tier.description}
                </p>
              )}

              <ul className="mt-6 space-y-2 flex-1">
                {(tier.features ?? []).map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span aria-hidden className="text-brand-primary mt-0.5">
                      ✓
                    </span>
                    <span className="text-text-secondary">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                {isFree ? (
                  <Link
                    href="/music"
                    className="block w-full text-center px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
                  >
                    Start Listening
                  </Link>
                ) : link ? (
                  <a
                    href={withEmail(link)}
                    onClick={(e) => handlePaidClick(e, withEmail(link))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
                  >
                    {showYearly ? "Join Yearly" : "Join Monthly"}
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="block w-full text-center px-6 py-3 rounded-full font-semibold border border-brand-border text-text-secondary cursor-not-allowed"
                  >
                    Coming Soon
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Logged-out prompt: create a free account first so the membership links
          to them. They can still continue as a guest if they insist. */}
      {pendingLink && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPendingLink(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-brand-border bg-brand-background p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold">Create your free account first</h3>
            <p className="mt-2 text-sm text-text-secondary">
              So your membership links to you and unlocks your perks, sign up (or
              log in) before checkout. It takes a few seconds.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Link
                href="/register"
                className="block w-full rounded-full bg-brand-primary px-6 py-3 text-center font-semibold text-white transition-colors hover:bg-brand-primary-dark"
              >
                Sign up free
              </Link>
              <Link
                href="/social/auth"
                className="block w-full rounded-full border border-brand-border px-6 py-3 text-center font-semibold text-text-primary transition-colors hover:bg-white/5"
              >
                Log in
              </Link>
              <a
                href={pendingLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setPendingLink(null)}
                className="mt-1 block w-full text-center text-xs text-text-secondary underline transition-colors hover:text-text-primary"
              >
                Continue as guest
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
