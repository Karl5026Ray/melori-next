import { Suspense } from "react";
import type { Metadata } from "next";
import WelcomeClient from "./WelcomeClient";

export const dynamic = "force-dynamic";

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
