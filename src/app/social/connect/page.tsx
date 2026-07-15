"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Heart, Compass, Inbox, ShieldCheck, RefreshCw } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { MatchCard } from "@/components/social/connect/MatchCard";
import { MatchCelebrationModal } from "@/components/social/connect/MatchCelebrationModal";
import type { ConnectCard } from "@/components/social/connect/types";

// Daily Music Matches — the primary Melori Connect surface. Shows the onboarding
// CTA when the caller has no active dating profile, otherwise the capped daily
// batch of cards with Like/Pass and a match celebration.
export default function ConnectHomePage() {
  const { user, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [cards, setCards] = useState<ConnectCard[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [celebration, setCelebration] = useState<{
    matchId: string | null;
    name: string;
    photo: string | null;
    hook?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/social/connect/matches-feed");
      if (!res.ok) {
        setCards([]);
        return;
      }
      const j = (await res.json()) as { needs_onboarding?: boolean; cards?: ConnectCard[] };
      setNeedsOnboarding(!!j.needs_onboarding);
      setCards(j.cards ?? []);
      setIndex(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) {
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, user, load]);

  const act = useCallback(
    async (action: "like" | "pass" | "super_like") => {
      const card = cards[index];
      if (!card || busy) return;
      setBusy(true);
      try {
        const res = await authFetch("/api/social/connect/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: card.profile_id, action }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          matched?: boolean;
          match?: { id: string } | null;
        };
        if (res.ok && j.matched) {
          setCelebration({
            matchId: j.match?.id ?? null,
            name: card.display_name || card.username || "your match",
            photo: card.photo_url || card.avatar_url,
            hook: card.harmony.explanation[0],
          });
        }
        setIndex((i) => i + 1);
      } finally {
        setBusy(false);
      }
    },
    [cards, index, busy],
  );

  if (authLoading || loading) {
    return <Centered>Loading your daily matches…</Centered>;
  }

  if (!user) {
    return (
      <Centered>
        <p className="mb-4 text-melori-muted">Sign in to use Melori Connect.</p>
        <Link href="/social/auth" className="btn-primary rounded-full px-6 py-2.5 text-sm font-semibold">
          Sign in
        </Link>
      </Centered>
    );
  }

  if (needsOnboarding) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-melori-purple to-melori-pink">
          <Heart className="h-8 w-8 text-white" fill="currentColor" />
        </div>
        <h1 className="text-2xl font-bold">Welcome to Melori Connect</h1>
        <p className="mt-2 text-melori-muted">
          Set up your dating profile to start getting daily music matches. It&apos;s a
          separate, 18+ opt-in — your music account stays private until you activate.
        </p>
        <Link
          href="/social/connect/onboarding"
          className="mt-6 rounded-full bg-gradient-to-r from-melori-purple to-melori-pink px-8 py-3 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Get started
        </Link>
        <Link href="/social/connect/safety" className="mt-3 text-xs text-melori-muted hover:text-melori-text">
          Read the Dating Safety Center
        </Link>
      </div>
    );
  }

  const current = cards[index];
  const exhausted = !current;

  return (
    <div className="flex flex-1 flex-col">
      <ConnectHeader />
      <div className="flex flex-1 flex-col items-center px-4 py-6">
        {exhausted ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-melori-elevated">
              <RefreshCw className="h-7 w-7 text-melori-muted" />
            </div>
            <h2 className="text-xl font-bold">You&apos;re all caught up</h2>
            <p className="mt-2 max-w-xs text-sm text-melori-muted">
              That&apos;s today&apos;s curated batch. Check back tomorrow, or explore more
              in Browse.
            </p>
            <div className="mt-6 flex gap-3">
              <Link
                href="/social/connect/browse"
                className="rounded-full border border-melori-border px-5 py-2.5 text-sm font-medium transition hover:border-melori-accent"
              >
                Browse more
              </Link>
              <button
                onClick={() => void load()}
                className="rounded-full bg-melori-elevated px-5 py-2.5 text-sm font-medium transition hover:bg-melori-border"
              >
                Refresh
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full">
            <p className="mb-4 text-center text-xs text-melori-muted">
              {cards.length - index} of {cards.length} today
            </p>
            <MatchCard
              card={current}
              busy={busy}
              onLike={() => void act("like")}
              onPass={() => void act("pass")}
              onSuperLike={() => void act("super_like")}
            />
          </div>
        )}
      </div>

      {celebration && (
        <MatchCelebrationModal
          matchId={celebration.matchId}
          otherName={celebration.name}
          otherPhoto={celebration.photo}
          myPhoto={user.avatar_url}
          hook={celebration.hook}
          onClose={() => setCelebration(null)}
        />
      )}
    </div>
  );
}

function ConnectHeader() {
  return (
    <header className="flex items-center justify-between border-b border-melori-border bg-melori-void/80 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <Heart className="h-5 w-5 text-melori-pink" fill="currentColor" />
        <h1 className="text-lg font-bold">Daily Music Matches</h1>
      </div>
      <nav className="flex items-center gap-1">
        <HeaderLink href="/social/connect/browse" icon={<Compass className="h-5 w-5" />} label="Browse" />
        <HeaderLink href="/social/connect/matches" icon={<Inbox className="h-5 w-5" />} label="Matches" />
        <HeaderLink href="/social/connect/safety" icon={<ShieldCheck className="h-5 w-5" />} label="Safety" />
      </nav>
    </header>
  );
}

function HeaderLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-melori-muted transition hover:bg-melori-elevated hover:text-melori-text"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center text-melori-muted">
      {children}
    </div>
  );
}
