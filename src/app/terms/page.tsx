import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms that govern your use of MELORI Music.",
};

export default function TermsPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-4">Terms of Service</h1>
        <p className="text-sm text-text-secondary mb-10">
          Last updated: June 29, 2026
        </p>

        <div className="space-y-8 text-text-secondary leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              The basics
            </h2>
            <p>
              MELORI Music is a platform for independent artists and fans. By
              using the site, you agree to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              For fans
            </h2>
            <p>
              Melori is free. There is nothing to buy and no membership to
              renew or cancel. Music you play or download is for personal use
              only &mdash; no redistribution.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              For artists
            </h2>
            <p>
              You keep ownership of your music. Melori does not sell music and
              takes no commission: there is nothing here to buy, so there are no
              sales, no fees and no payouts. Your work stays yours, and you can
              remove it at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Content
            </h2>
            <p>
              No hate speech, no stolen content, no spam. We reserve the right
              to remove content that violates these rules or applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Limitation of liability
            </h2>
            <p>
              MELORI Music is provided &quot;as is.&quot; We&apos;re not liable
              for downtime, data loss, or disputes between users. Maximum
              liability is the amount you paid us in the prior 12 months.
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
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
