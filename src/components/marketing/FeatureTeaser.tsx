import Link from "next/link";

// The public face of a members-only room.
//
// Karl: "Faces should have a page telling people to join etc.... MM space, MM
// cinema, radio."
//
// The signup wall closed /social/live, /social/spaces, /social/cinema and
// /social/radio to strangers, which was right — a stranger cannot join a room,
// and the radio pool answers 401 to anonymous callers, so those pages offered
// them a product they could not use. But bouncing every one of them to a bare
// signup form throws away the reason they clicked.
//
// So each live surface gets a public page that explains what happens inside and
// asks for the account. The proxy sends a signed-out visitor here instead of to
// the door, which means a shared link to a room still lands somewhere that makes
// sense, and Google has something real to index for four features that were
// previously invisible to it.
//
// WHAT THIS PAGE MUST NEVER CONTAIN
// ---------------------------------
// Live room listings. The real pages show host names, avatars and who is on
// camera right now; /api/social/faces and the spaces queries hand that to
// anonymous callers today. Melori runs women-only rooms, so publishing who is
// live to strangers is a safety question, not just a privacy one. Everything
// here is written copy. If you find yourself passing member data into this
// component, that is the bug.

export interface TeaserPoint {
  title: string;
  body: string;
}

export interface FeatureTeaserProps {
  /** Small label above the title, e.g. "MM Faces". */
  eyebrow: string;
  title: string;
  /** One or two sentences. Says what the thing IS, in plain words. */
  lede: string;
  points: TeaserPoint[];
  /** Answers "what actually happens when I join". */
  howItWorks: string[];
  /** The page's own href, so it is excluded from the cross-links below. */
  self: string;
}

const SURFACES: { href: string; label: string }[] = [
  { href: "/faces", label: "MM Faces" },
  { href: "/spaces", label: "MM Spaces" },
  { href: "/cinema", label: "MM Cinema" },
  { href: "/radio", label: "Radio" },
  { href: "/gallery", label: "Photography" },
];

export default function FeatureTeaser({
  eyebrow,
  title,
  lede,
  points,
  howItWorks,
  self,
}: FeatureTeaserProps) {
  return (
    <div className="bg-brand-background text-text-primary">
      <section className="relative overflow-hidden border-b border-brand-border">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto max-w-4xl px-6 py-20 sm:py-28">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-primary">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-tight md:text-5xl">
            {title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-secondary md:text-xl">
            {lede}
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/register"
              className="rounded-full bg-brand-primary px-7 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-primary-dark"
            >
              Create your free account
            </Link>
            <Link
              href="/social/auth"
              className="rounded-full border border-brand-border px-7 py-3 text-center text-sm font-semibold text-text-primary transition-colors hover:border-brand-primary hover:text-brand-primary"
            >
              Already a member? Sign in
            </Link>
          </div>
          <p className="mt-4 text-sm text-text-secondary">
            Free to join. All the music is free to every member.
          </p>
        </div>
      </section>

      <section className="border-b border-brand-border">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <div className="grid gap-8 sm:grid-cols-3">
            {points.map((point) => (
              <div key={point.title}>
                <h2 className="text-lg font-semibold">{point.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  {point.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-brand-border">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="text-2xl font-bold">How it works</h2>
          <ol className="mt-6 space-y-4">
            {howItWorks.map((step, i) => (
              <li key={step} className="flex gap-4">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-muted text-xs font-bold text-brand-primary"
                >
                  {i + 1}
                </span>
                <span className="text-text-secondary">{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-12 rounded-2xl border border-brand-border bg-brand-surface p-6">
            <p className="font-semibold">
              The room itself is for members only.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              People go on camera and on microphone here, so who is in the room
              is not something we publish. Create an account and you are in.
            </p>
            <Link
              href="/register"
              className="mt-5 inline-block rounded-full bg-brand-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-dark"
            >
              Create your free account
            </Link>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-4xl px-6 py-12">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Also on Melori
          </h2>
          <nav className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {SURFACES.filter((s) => s.href !== self).map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="text-text-secondary transition-colors hover:text-brand-primary"
              >
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
      </section>
    </div>
  );
}
