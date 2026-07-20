import Link from "next/link";
import type { Metadata } from "next";
import {
  Camera,
  Images,
  Tag,
  CalendarClock,
  ArrowRight,
  Sparkles,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Photography | Karl Ray Photography — Melori Music",
  description:
    "Karl Ray Photography on Melori Music — browse delivered galleries, view session pricing, and book your next shoot in minutes.",
  openGraph: {
    title: "Karl Ray Photography | Melori Music",
    description:
      "Browse galleries, view pricing, and book a photography session with Karl Ray Photography.",
    type: "website",
  },
};

const links = [
  {
    href: "/gallery",
    label: "Portfolio & Galleries",
    desc: "Browse delivered client galleries and recent work.",
    icon: Images,
  },
  {
    href: "/pricing",
    label: "Pricing",
    desc: "See session packages, duration, and pricing.",
    icon: Tag,
  },
  {
    href: "/book",
    label: "Book a Session",
    desc: "Pick a service, choose a time, and reserve your spot.",
    icon: CalendarClock,
  },
];

export default function PhotographyHubPage() {
  return (
    <main className="min-h-screen bg-brand-background text-text-primary">
      {/* Brand hero */}
      <section className="relative overflow-hidden border-b border-brand-border">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-brand-primary/15 via-brand-background to-brand-accent/10"
        />
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-24 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
            <Camera className="h-7 w-7" />
          </span>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Melori Music Photography
          </p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight">
            Karl Ray Photography
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base sm:text-lg text-text-secondary">
            Portraits, events, and sessions — delivered through private
            galleries, booked in a few taps.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/book"
              className="w-full sm:w-auto rounded-full bg-brand-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-dark text-center"
            >
              Book a Session
            </Link>
            <Link
              href="/gallery"
              className="w-full sm:w-auto rounded-full border border-brand-border px-6 py-3 text-sm font-semibold text-text-primary transition-colors hover:border-brand-primary hover:text-brand-primary text-center"
            >
              View Galleries
            </Link>
          </div>
        </div>
      </section>

      {/* Hub links */}
      <section className="mx-auto max-w-5xl px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="text-lg font-semibold">Everything in one place</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Explore your options below.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {links.map(({ href, label, desc, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col rounded-2xl border border-brand-border bg-brand-surface p-5 transition-colors hover:border-brand-primary"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="mt-4 flex items-center gap-1.5 font-semibold text-text-primary">
                {label}
                <ArrowRight className="h-4 w-4 text-brand-primary transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="mt-1 text-sm text-text-secondary">{desc}</span>
            </Link>
          ))}
        </div>

        <p className="mt-12 text-center text-xs text-text-secondary">
          Questions?{" "}
          <a
            href="mailto:karlrayphotography@gmail.com"
            className="text-brand-primary hover:underline"
          >
            Email Karl Ray Photography
          </a>
          .
        </p>
      </section>
    </main>
  );
}
