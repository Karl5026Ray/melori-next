import type { Metadata } from "next";
import MoroccoThankYou from "@/components/morocco/MoroccoThankYou";

// Where Stripe sends Morocco trip supporters after they pay
// (/morocco/thank-you?tier=50&session_id={CHECKOUT_SESSION_ID}).
// Public (PUBLIC_EXACT in src/proxy.ts). Static on purpose: the query string is
// read on the client, so nothing here makes the route dynamic / no-store.

export const metadata: Metadata = {
  title: "Thank you — Karl & Blessing in Marrakech",
  robots: { index: false, follow: false },
};

export default function MoroccoThankYouPage() {
  return (
    <div className="min-h-screen bg-brand-background text-text-primary">
      <main className="max-w-lg mx-auto px-4 pt-10 pb-16">
        <MoroccoThankYou />
      </main>
    </div>
  );
}
