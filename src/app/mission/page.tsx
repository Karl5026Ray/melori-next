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
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full border border-brand-border text-sm text-text-secondary">
            Our Why
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight">
            Most apps treat music like inventory to sell.{" "}
            <span className="text-brand-primary">
              Melori treats artists as people building real careers.
            </span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed">
            We&apos;re not another streaming service&mdash;we&apos;re the
            operating system for independent musicians. No middlemen taking the
            majority of your money. No algorithms calling the shots. Just music,
            community, and fair exchange.
          </p>
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
                title: "Fair pay",
                desc: "Artists keep their money from every sale with only a Stripe fee and taxes removed. No black-box algorithms deciding who gets paid.",
              },
              {
                num: "02",
                title: "Own your platform",
                desc: "Your profile, your fans, your data. Export anytime. We don't trap artists — we liberate them.",
              },
              {
                num: "03",
                title: "Community first",
                desc: "Fans aren't metrics. They're the reason we exist. Direct messages, exclusive content, real connection.",
              },
              {
                num: "04",
                title: "Quality over quantity",
                desc: "Curated catalog. No filler tracks to game playlists. Every release matters because someone chose it.",
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
