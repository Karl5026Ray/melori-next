import type { Metadata } from "next";
import Link from "next/link";
import { Music, Heart, ShieldCheck, Sparkles } from "lucide-react";

// Public marketing landing for Melori Connect. Static/ISR-friendly — no server
// auth. Uses brand-primary (#ff5500) accents per brief. The CTA routes into the
// authed app; the social shell handles the sign-in bounce for logged-out users.
export const metadata: Metadata = {
  title: "Melori Connect",
  description:
    "Real, unpredateable connections — because life is unpredictable. Music-affinity dating on Melori, matched on the artists and taste you already share.",
};

export const revalidate = 3600;

export default function ConnectLandingPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-brand-background text-text-primary">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/20 via-transparent to-transparent" />
        <div className="relative mx-auto max-w-4xl px-6 py-20 text-center sm:py-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-primary/40 bg-brand-primary/10 px-4 py-1.5 text-sm font-medium text-brand-primary">
            <Sparkles className="h-4 w-4" /> New on Melori
          </span>
          <h1 className="mt-6 text-5xl font-extrabold tracking-tight sm:text-6xl">
            Melori <span className="text-brand-primary">Connect</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
            Real, unpredateable connections — because life is unpredictable.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-base text-text-secondary">
            Dating built on what you already share: the artists you follow, the genres
            that find you, and the community you&apos;re part of. No cold swipe deck —
            just a curated handful of music-matched people each day.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/social/connect"
              className="rounded-full bg-brand-primary px-8 py-3.5 text-base font-semibold text-white shadow-lg transition hover:bg-brand-primary-dark"
            >
              Open Melori Connect
            </Link>
            <Link
              href="/social/connect/safety"
              className="rounded-full border border-brand-border px-8 py-3.5 text-base font-medium text-text-secondary transition hover:text-text-primary"
            >
              Safety &amp; trust
            </Link>
          </div>
          <p className="mt-4 text-xs text-text-secondary">
            18+ only. A separate, revocable opt-in — your music account stays yours.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-3">
          <Feature
            icon={<Music className="h-6 w-6 text-brand-primary" />}
            title="Matched on music"
            body="Your Harmony Score is explainable — see the exact shared artists, genres, and follows behind every match."
          />
          <Feature
            icon={<Heart className="h-6 w-6 text-brand-primary" />}
            title="Daily curated picks"
            body="A small, considered batch of people each day — not an endless feed. Like or pass, and match when it's mutual."
          />
          <Feature
            icon={<ShieldCheck className="h-6 w-6 text-brand-primary" />}
            title="Safe by design"
            body="Match-gated messaging, one-tap block/report/unmatch, and NCII / TAKE IT DOWN reporting built in."
          />
        </div>
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-brand-border bg-brand-surface p-6">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-primary/10">
        {icon}
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm text-text-secondary">{body}</p>
    </div>
  );
}
