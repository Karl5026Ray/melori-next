// The Melori mission statement and "The MELORI way".
//
// Lived on /mission until 2026-10-17, when Karl moved it into his own
// introduction page (/karlray#mission): "replace the mission statement and
// place the mission within my introduction page." /mission now redirects
// there (src/app/mission/page.tsx).
export default function MissionStatement() {
  return (
    <>
      <section id="mission" className="relative overflow-hidden scroll-mt-24 border-t border-brand-border">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-4xl mx-auto px-6 py-16">
          <h1 className="text-4xl md:text-5xl font-bold text-text-primary mb-8">
            Mission Statement
          </h1>
          <div className="space-y-6 text-lg md:text-xl text-text-secondary max-w-3xl leading-relaxed text-left">
            <p>
              Melori is the creative infrastructure for independent musicians
              &mdash; not a streaming catalog, not a marketplace, but a
              full-stack career operating system. We believe artists are
              founders, not inventory: while the industry treats music as content
              to be extracted, we treat musicians as professionals building
              sustainable careers, combining a free platform, live audio community,
              and direct artist-fan relationships into one sovereign ecosystem.
              No paywalls between you and your listeners, no opaque algorithms
              dictating your visibility, no platform lock-in holding your
              audience hostage &mdash; just genuine social connection and the
              tools to turn listeners into a community, and a community into a
              career.
            </p>
            <p className="text-2xl md:text-3xl font-bold text-text-primary pt-2">
              Melori. Build your sound. Own your future.
            </p>
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
                title: "Free to Everyone",
                desc: "Melori sells nothing. No subscriptions, no tiers, no upgrades, no checkout — every feature is open to every account. No opaque distribution algorithms and no intermediary gatekeeping standing between artists and the people who listen.",
              },
              {
                num: "02",
                title: "Platform Sovereignty",
                desc: "Your audience, your data, your infrastructure. Full exportability at any time. We operate on a principle of radical portability — not vendor lock-in.",
              },
              {
                num: "03",
                title: "Artist-Fan Authenticity",
                desc: "Supporters are not aggregated data points. Direct messaging and unmediated engagement restore the human relationship at the center of the creative economy.",
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

    </>
  );
}
