import type { Metadata } from "next";
import Link from "next/link";
import {
  Heart,
  Star,
  X,
  Music2,
  MapPin,
  BadgeCheck,
  Shield,
  Users,
  MessageCircle,
  Sparkles,
  Video,
  Lock,
  Headphones,
  TrendingUp,
} from "lucide-react";
import ConnectLandingCTA from "./ConnectLandingCTA";

export const metadata: Metadata = {
  title: "Melori Connect — Meet people through your music",
  description:
    "Melori Connect matches you with members who share your music taste. Build a profile, see real compatibility scores, swipe, match, and start a conversation.",
  openGraph: {
    title: "Melori Connect — Meet people through your music",
    description:
      "The dating feature that matches you on the music you actually listen to. Swipe, match, and message members who share your taste on Melori Music.",
    images: ["/images/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Melori Connect — Meet people through your music",
    description:
      "The dating feature that matches you on the music you actually listen to.",
    images: ["/images/og-image.png"],
  },
};

// A dating landing page that turns the in-app Connect feature into a
// discoverable front door on melorimusic.org. Fully static (no Supabase read),
// so it prerenders and stays cache-friendly. The only client island is the
// auth-aware CTA, which sends signed-in members straight into the swipe stack.

const STEPS = [
  {
    icon: Users,
    title: "Build your profile",
    body: "Add a few photos, a headline, and what you're looking for. Your music taste comes along automatically from the songs you stream on Melori — no quiz required.",
  },
  {
    icon: TrendingUp,
    title: "We score real compatibility",
    body: "Our algorithm blends the tracks you both listen to, the artists you both follow, and your saved playlists into a genuine 0–100 compatibility score on every profile.",
  },
  {
    icon: MessageCircle,
    title: "Swipe, match, message",
    body: "Like, super-like, or pass. The moment it's mutual, you match and a private conversation opens instantly — no waiting, no middleman.",
  },
];

const FEATURES = [
  {
    icon: Music2,
    title: "Matching on taste, not just looks",
    body: "Every card shows a live compatibility score built from your listening history. Photos matter, but the song you both have on repeat matters more.",
  },
  {
    icon: Video,
    title: "Intro videos",
    body: "Add a short clip to your card so people hear your voice and see you move before they ever swipe. It's the closest thing to meeting in person.",
  },
  {
    icon: Star,
    title: "See who likes you",
    body: "Skip the guessing. A dedicated tab shows everyone who's already liked you, with one tap to match back or pass.",
  },
  {
    icon: Shield,
    title: "Safer by design",
    body: "Connect is 18+ and Superfan-gated, so members have skin in the game. Block and report are built into every profile.",
  },
];

export default function ConnectLandingPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        {/* Warm brand glow + a Connect-pink wash so the dating page has its
            own atmosphere without leaving the brand system. */}
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div
          className="absolute inset-x-0 top-0 -z-10 h-[420px] opacity-60"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 75% 0%, rgba(236,72,153,0.16) 0%, rgba(139,92,246,0.10) 40%, transparent 72%)",
          }}
        />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pt-4 pb-10 md:grid-cols-2 md:gap-12 md:py-28">
          {/* Copy */}
          <div className="animate-fade-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-melori-pink/40 bg-melori-pink/10 px-4 py-1.5 text-sm font-medium text-melori-pink">
              <Sparkles className="h-4 w-4" />
              Melori Connect
            </span>
            <h1 className="mt-4 text-3xl font-bold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
              Meet someone who gets your{" "}
              <span className="gradient-text">taste in music</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-text-secondary">
              The dating feature that matches you on the songs you actually
              listen to. No generic profiles — just real connections through the
              music you both love.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <ConnectLandingCTA />
              <Link
                href="/membership"
                className="rounded-full border border-brand-border bg-brand-surface px-6 py-3.5 text-base font-semibold text-text-primary transition-colors hover:border-melori-pink/50 hover:text-white"
              >
                Become a member
              </Link>
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
              <Lock className="h-4 w-4" />
              18+ · Superfan membership required to match
            </p>
          </div>

          {/* Swipe stack mockup */}
          <div className="relative mx-auto h-[460px] w-full max-w-sm animate-slide-up md:mx-0">
            <SwipeCardMock
              depth={2}
              name="Amara, 27"
              city="Atlanta, GA"
              headline="Neo-soul head. Sade on repeat."
              score={94}
              className="left-6 top-6 opacity-70"
            />
            <SwipeCardMock
              depth={1}
              name="Daniel, 31"
              city="Houston, TX"
              headline="Jazz guitar & long late-night drives."
              score={88}
              className="left-3 top-3 opacity-90"
            />
            {/* Top card — the one a user is "deciding" on */}
            <SwipeCardMock
              depth={0}
              name="Kemi, 25"
              city="Lagos, NG"
              headline="Afrobeats from sunup to sundown."
              score={97}
              className="left-0 top-0"
              top
            />
          </div>
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section className="border-t border-brand-border bg-brand-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">How it works</h2>
            <p className="mt-4 text-lg text-text-secondary">
              Your music taste does the icebreaking for you.
            </p>
          </div>
          <ol className="mt-14 grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="relative rounded-2xl border border-brand-border bg-brand-surface p-7"
              >
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-melori-pink/15 text-melori-pink">
                  <s.icon className="h-6 w-6" />
                </div>
                <div className="absolute right-6 top-6 text-5xl font-black text-white/5">
                  {i + 1}
                </div>
                <h3 className="text-xl font-bold">{s.title}</h3>
                <p className="mt-3 leading-relaxed text-text-secondary">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ===== Compatibility callout ===== */}
      <section className="border-t border-brand-border">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">
              A compatibility score you can actually trust
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-text-secondary">
              Most dating apps match on swipes and distance. Connect weighs the
              things that predict a real connection — shared listening history,
              the artists you both follow, and the tracks you've both saved.
              The result is a transparent score on every card, not a black box.
            </p>
            <ul className="mt-8 space-y-4">
              <ScoreRow icon={Headphones} label="Shared tracks you both listen to" weight={30} />
              <ScoreRow icon={Users} label="Artists you both follow" weight={25} />
              <ScoreRow icon={Music2} label="Tracks you've both saved" weight={15} />
              <ScoreRow icon={Heart} label="Mutual preferences & age fit" weight={30} />
            </ul>
          </div>

          {/* Score dial */}
          <div className="flex justify-center">
            <div className="relative flex h-64 w-64 items-center justify-center rounded-full border border-melori-pink/30 bg-melori-elevated/60 shadow-2xl">
              <div
                className="absolute inset-0 rounded-full opacity-40"
                aria-hidden
                style={{
                  background:
                    "conic-gradient(from 180deg, #ec4899 0deg, #8b5cf6 240deg, transparent 349deg, transparent 360deg)",
                  WebkitMask:
                    "radial-gradient(farthest-side, transparent calc(100% - 14px), #000 calc(100% - 13px))",
                  mask: "radial-gradient(farthest-side, transparent calc(100% - 14px), #000 calc(100% - 13px))",
                }}
              />
              <div className="text-center">
                <div className="text-6xl font-black gradient-text">97</div>
                <div className="mt-1 text-sm font-medium uppercase tracking-widest text-melori-muted">
                  % match
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Features grid ===== */}
      <section className="border-t border-brand-border bg-brand-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">
              Built for real conversations
            </h2>
            <p className="mt-4 text-lg text-text-secondary">
              Everything you need to move from a match to a message.
            </p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-brand-border bg-brand-surface p-6 transition-colors hover:border-melori-pink/40"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-melori-purple/15 text-melori-purple">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Safety ===== */}
      <section className="border-t border-brand-border">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-melori-teal/15 text-melori-teal">
            <Shield className="h-8 w-8" />
          </div>
          <h2 className="text-3xl font-bold sm:text-4xl">Safer by design</h2>
          <p className="mt-5 text-lg leading-relaxed text-text-secondary">
            Connect is 18+ and gated behind a Superfan membership, so members
            have skin in the game. We never share your precise location, you can
            block anyone at any time, and every profile carries a one-tap
            report. Your listening taste is the only signal we use to find your
            matches — never your contacts or your DMs.
          </p>
        </div>
      </section>

      {/* ===== Final CTA ===== */}
      <section className="relative overflow-hidden border-t border-brand-border">
        <div
          className="absolute inset-0 -z-10 opacity-70"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 50% 80% at 50% 120%, rgba(255,85,0,0.20) 0%, rgba(139,92,246,0.10) 45%, transparent 75%)",
          }}
        />
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <Heart className="mx-auto mb-5 h-10 w-10 text-melori-pink" />
          <h2 className="text-3xl font-bold sm:text-5xl">Ready to meet your match?</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-text-secondary">
            Join Melori Connect and meet members who already share your taste.
            Your next favorite duet could be one swipe away.
          </p>
          <div className="mt-8 flex justify-center">
            <ConnectLandingCTA />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------- decorative sub-components (static, no data) ---------- */

function SwipeCardMock({
  depth,
  name,
  city,
  headline,
  score,
  className,
  top = false,
}: {
  depth: number;
  name: string;
  city: string;
  headline: string;
  score: number;
  className: string;
  top?: boolean;
}) {
  return (
    <div
      className={`absolute h-[420px] w-[280px] overflow-hidden rounded-2xl border border-white/10 bg-melori-elevated shadow-2xl ${className}`}
      style={{ transform: `scale(${1 - depth * 0.05})`, zIndex: 10 - depth }}
    >
      {/* Gradient "photo" stand-in so the mock is self-contained (no asset) */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background:
            "linear-gradient(160deg, #2a1a3e 0%, #4a1f4d 45%, #b3326b 100%)",
        }}
      />
      {/* compatibility chip — only on the stacked back cards; the top card
          shows the swipe-action stamps instead so the two never overlap */}
      {!top && (
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold backdrop-blur">
          <Music2 className="h-3.5 w-3.5 text-melori-pink" />
          {score}% match
        </div>
      )}
      {top && (
        <>
          <div className="pointer-events-none absolute left-4 top-6 -rotate-[16deg] rounded-lg border-4 border-melori-pink px-3 py-1 text-2xl font-black text-melori-pink">
            LIKE
          </div>
          <div className="pointer-events-none absolute right-4 top-6 rotate-[16deg] rounded-lg border-4 border-white px-3 py-1 text-2xl font-black text-white/80">
            NOPE
          </div>
        </>
      )}
      {/* info gradient */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-5 pt-16">
        <div className="flex items-center gap-2">
          <h3 className="text-2xl font-bold text-white">{name}</h3>
          <BadgeCheck className="h-5 w-5 text-melori-pink" />
        </div>
        <p className="mt-0.5 flex items-center gap-1 text-sm text-white/80">
          <MapPin className="h-3.5 w-3.5" />
          {city}
        </p>
        <p className="mt-1 text-sm text-white/90">{headline}</p>
      </div>
    </div>
  );
}

function ScoreRow({
  icon: Icon,
  label,
  weight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  weight: number;
}) {
  return (
    <li className="flex items-center gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-melori-purple/15 text-melori-purple">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">{label}</span>
          <span className="text-sm font-semibold text-text-secondary">
            up to {weight}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-brand-muted">
          <div
            className="h-full rounded-full"
            style={{
              width: `${(weight / 30) * 100}%`,
              background: "linear-gradient(90deg, #ec4899, #8b5cf6)",
            }}
          />
        </div>
      </div>
    </li>
  );
}
