import { Suspense } from "react";
import type { Metadata } from "next";
import WelcomeClient from "./WelcomeClient";

// No `dynamic = "force-dynamic"` here (see issue #280 and #284) — this page
// itself performs no server-side reads. All of the per-user work (looking up
// the Stripe session, verifying the purchase, creating the account) happens
// client-side inside <WelcomeClient>, which is already wrapped in <Suspense>
// below, exactly the pattern issue #284 asked for. That keeps this route
// statically prerenderable so it never emits the `no-store` Cache-Control
// header that broke / and /music in iOS WebView wrapper browsers.

export const metadata: Metadata = {
  title: "Welcome to Melori",
  description: "Finish setting up your Melori membership.",
  robots: { index: false, follow: false },
};

export default function WelcomePage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-md mx-auto px-6 py-16">
          <Suspense
            fallback={
              <p className="text-center text-text-secondary">Loading…</p>
            }
          >
            <WelcomeClient />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
