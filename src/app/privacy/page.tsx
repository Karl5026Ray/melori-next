import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How MELORI Music handles your data.",
};

export default function PrivacyPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-4">Privacy Policy</h1>
        <p className="text-sm text-text-secondary mb-10">
          Last updated: June 29, 2026
        </p>

        <div className="space-y-8 text-text-secondary leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              What we collect
            </h2>
            <p>
              Email address (for your account and purchase confirmations).
              Payment info (handled entirely by Stripe — we never see your card
              number). Basic listening activity (to improve recommendations).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              What we don&apos;t do
            </h2>
            <p>
              We don&apos;t sell your data. We don&apos;t track you across the
              web. We don&apos;t share information with third parties except as
              required to operate the platform (Stripe for payments, Resend for
              transactional email).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Your rights
            </h2>
            <p>
              You can export your data anytime. Delete your account and we
              purge everything. Email{" "}
              <a
                href="mailto:support@melorimusic.org"
                className="text-brand-primary hover:underline"
              >
                support@melorimusic.org
              </a>{" "}
              for requests.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Cookies
            </h2>
            <p>
              Essential cookies only (login session, cart). No tracking
              cookies. No advertising pixels.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Contact
            </h2>
            <p>
              Questions? Email{" "}
              <a
                href="mailto:support@melorimusic.org"
                className="text-brand-primary hover:underline"
              >
                support@melorimusic.org
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
