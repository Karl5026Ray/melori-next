import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support",
  description: "Help and contact information for MELORI Music.",
};

const faqs = [
  {
    q: "I didn't receive my download email",
    a: "Check your spam or promotions folder. If it's still missing, email us with the address you used at checkout and we'll resend.",
  },
  {
    q: "My download link expired",
    a: "Links allow multiple downloads and don't expire by time. If you hit the limit, email us and we'll reissue.",
  },
  {
    q: "I want a refund",
    a: "Digital purchases are final, but contact us within 48 hours if there's a genuine issue and we'll make it right.",
  },
  {
    q: "How do I cancel my membership?",
    a: "You can cancel anytime from your account settings, or by emailing us. Cancellations take effect at the end of the current billing period.",
  },
  {
    q: "I'm an artist — how do I get paid?",
    a: "Artists receive payouts monthly via Stripe Connect. Add your payout details in your artist dashboard to start receiving payments.",
  },
];

export default function SupportPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-8">Support</h1>

        <div className="p-6 rounded-xl border border-brand-primary/40 bg-brand-primary/10 mb-12">
          <h2 className="text-xl font-semibold mb-2">Email us</h2>
          <a
            href="mailto:support@melorimusic.org"
            className="text-brand-primary hover:underline text-lg"
          >
            support@melorimusic.org
          </a>
          <p className="text-text-secondary mt-2 text-sm">
            We typically respond within 24 hours.
          </p>
        </div>

        <h2 className="text-2xl font-semibold mb-4">Common questions</h2>
        <div className="space-y-3">
          {faqs.map((item, i) => (
            <details
              key={i}
              className="p-4 rounded-lg border border-brand-border bg-white/5 group"
            >
              <summary className="cursor-pointer font-medium text-text-primary">
                {item.q}
              </summary>
              <p className="mt-3 text-sm text-text-secondary leading-relaxed">
                {item.a}
              </p>
            </details>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-text-secondary">Still need help?</p>
          <a
            href="mailto:support@melorimusic.org"
            className="inline-block mt-2 text-brand-primary font-medium hover:underline"
          >
            Contact support@melorimusic.org
          </a>
        </div>
      </div>
    </div>
  );
}
