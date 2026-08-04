import Link from "next/link";

/**
 * The meaning of the name "Melori" — mel (melody) + lori (lullaby).
 *
 * Two variants of the same story:
 *   • "compact" — a single band on the homepage, for visitors who will never
 *     click through to /mission.
 *   • "full" — the anchored section on /mission (#the-name) that the homepage
 *     band and the footer both link to.
 */
export default function NameMeaning({
  variant = "compact",
}: {
  variant?: "compact" | "full";
}) {
  if (variant === "compact") {
    return (
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="rounded-2xl border border-brand-border bg-white/5 p-8 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-primary">
            The name
          </p>
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">
            Melori is two words folded into one
          </h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <p className="text-sm leading-relaxed text-text-secondary">
              <span className="font-semibold text-text-primary">Mel</span> is{" "}
              <span className="text-text-primary">melody</span> — the line you
              keep humming after the song ends, the part of a record that
              survives without the production around it.
            </p>
            <p className="text-sm leading-relaxed text-text-secondary">
              <span className="font-semibold text-text-primary">Lori</span> is{" "}
              <span className="text-text-primary">lullaby</span> — the first
              music almost anyone hears, sung by someone who loves them, long
              before they know what a genre is or who owns a master.
            </p>
          </div>
          <p className="mt-6 text-base leading-relaxed text-text-secondary">
            Together they describe the full span of what music does: it moves
            you, and it keeps you. A melody reaches out. A lullaby holds. That
            is the standard we hold this catalog to.
          </p>
          <Link
            href="/mission#the-name"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary hover:underline"
          >
            Read the whole story
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section id="the-name" className="border-t border-brand-border scroll-mt-24">
      <div className="max-w-3xl mx-auto px-6 py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-primary">
          The name
        </p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">
          Why we are called Melori
        </h2>

        <div className="mt-8 space-y-6 text-lg leading-relaxed text-text-secondary">
          <p>Melori is two words folded into one.</p>
          <p>
            <span className="font-semibold text-text-primary">Mel</span> is{" "}
            <span className="text-text-primary">melody</span> — the line you keep
            humming after the song is over. It is the part of music that survives
            without the production around it, the thing a stranger can carry home
            after hearing it once.
          </p>
          <p>
            <span className="font-semibold text-text-primary">Lori</span> is{" "}
            <span className="text-text-primary">lullaby</span> — the first music
            almost anyone hears. It is sung by someone who loves them, long
            before they know what a genre is, what a chart is, or who owns a
            master.
          </p>
          <p>
            Put together, they describe the full span of what music actually does
            for a person: it moves you, and it keeps you. A melody reaches out; a
            lullaby holds. One is performance, the other is care — and the songs
            that last tend to be the ones doing both at once.
          </p>
          <p>
            That is the standard we hold this catalog to. Not what is engineered
            to trend for a weekend, but what someone will still play years from
            now and pass on to somebody else.
          </p>
          <p>
            It is also why the economics here are built the way they are. If a
            song is meant to stay with a listener for a lifetime, the person who
            wrote it should be paid like that matters — which is why music sales
            on Melori carry no platform cut, and artists keep every dollar after
            payment processing.
          </p>
        </div>

        <p className="mt-10 text-2xl font-bold text-text-primary md:text-3xl">
          Melori. Melody and lullaby. Music that moves you, music that stays.
        </p>
      </div>
    </section>
  );
}
