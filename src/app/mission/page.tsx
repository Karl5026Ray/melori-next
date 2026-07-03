import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mission",
  description:
    "Most apps treat music like inventory to sell. Melori treats artists as people building real careers — the operating system for independent musicians.",
  openGraph: {
    title: "Mission",
    description:
      "Most apps treat music like inventory to sell. Melori treats artists as people building real careers.",
    images: ["/images/og-image.png"],
  },
};

export default function MissionPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-4xl mx-auto px-6 py-24 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-text-primary mb-8">
            Mission Statement
          </h1>
          <div className="space-y-6 text-lg md:text-xl text-text-secondary max-w-3xl mx-auto leading-relaxed">
            <p>
              Melori is the creative infrastructure for independent musicians
              &mdash; not a streaming catalog, not a marketplace, but a
              full-stack career operating system. We believe artists are
              founders, not inventory: while the industry treats music as content
              to be extracted, we treat musicians as professionals building
              sustainable livelihoods, combining fair monetization, live audio
              community, and direct artist-fan relationships into one sovereign
              ecosystem. No intermediaries siphoning the majority of your
              revenue, no opaque algorithms dictating your visibility, no
              platform lock-in holding your audience hostage &mdash; just
              transparent economics, genuine social connection, and the tools to
              turn listeners into a community, and a community into a career.
            </p>
            <p className="text-2xl md:text-3xl font-bold text-text-primary pt-2">
              Melori. Build your sound. Own your future.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-brand-border">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-bold text-center mb-12">
            The status quo is broken
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                stat: "$0.003",
                title: "Artists earn pennies",
                desc: "Average per-stream payout on major platforms. A million streams = $3,000. Not enough to pay rent.",
              },
              {
                stat: "100%",
                title: "Fans are data points",
                desc: "Your listening habits are sold to advertisers. You're the product, not the customer.",
              },
              {
                stat: "3",
                title: "Gatekeepers decide",
                desc: "Companies control 90% of global music distribution. Independent voices are buried.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="p-8 rounded-xl border border-brand-border bg-white/5"
              >
                <div className="text-3xl font-bold text-brand-primary mb-2">
                  {item.stat}
                </div>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-text-secondary leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-brand-border">
        <div className="max-w-4xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-bold text-center mb-12">
            The MELORI way
          </h2>
          <div className="space-y-10">
            {[
              {
                num: "01",
                title: "Transparent Monetization",
                desc: "Artists retain full proceeds from every transaction, less only standard payment processing fees and applicable taxes. No opaque distribution algorithms or intermediary gatekeeping determining compensation.",
              },
              {
                num: "02",
                title: "Platform Sovereignty",
                desc: "Your audience, your data, your infrastructure. Full exportability at any time. We operate on a principle of radical portability — not vendor lock-in.",
              },
              {
                num: "03",
                title: "Artist-Fan Authenticity",
                desc: "Supporters are not aggregated data points. Direct messaging, exclusive access tiers, and unmediated engagement restore the human relationship at the center of the creative economy.",
              },
              {
                num: "04",
                title: "Editorial Integrity",
                desc: "A deliberately curated catalog. No playlist-gaming filler or volume-for-volume's-sake releases. Every title in the library reflects a deliberate curatorial decision — and therefore, genuine value.",
              },
            ].map((item) => (
              <div key={item.num} className="flex gap-6 items-start">
                <div className="text-4xl font-bold text-brand-primary/30 shrink-0">
                  {item.num}
                </div>
                <div>
                  <h3 className="text-2xl font-semibold mb-2">{item.title}</h3>
                  <p className="text-text-secondary text-lg leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-brand-border">
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Join the mission
          </h2>
          <p className="text-text-secondary text-lg mb-8">
            Whether you&apos;re here to listen, support, or create — there&apos;s a
            place for you.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/membership"
              className="px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
            >
              Become a Member
            </Link>
            <Link
              href="/music"
              className="px-6 py-3 rounded-full font-semibold border border-brand-border hover:border-brand-primary transition-colors"
            >
              Explore the Music
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
