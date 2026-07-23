"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Tier = "superfan" | "artist" | null;

interface SessionInfo {
  email: string | null;
  tier: Tier;
  existingAccount: boolean;
}

const tierLabel = (t: Tier) =>
  t === "artist" ? "Artist" : t === "superfan" ? "Superfan" : "Member";

export default function WelcomeClient() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [info, setInfo] = useState<SessionInfo | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [existingNotice, setExistingNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!sessionId) {
      setLoading(false);
      setLoadError("missing");
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/welcome/session?session_id=${encodeURIComponent(sessionId)}`,
        );
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          setLoadError(data.error ?? "We couldn't verify your purchase.");
        } else {
          setInfo(data as SessionInfo);
        }
      } catch {
        if (active) setLoadError("We couldn't verify your purchase.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [sessionId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !sessionId || !info) return;
    setSubmitting(true);
    setFormError(null);
    setExistingNotice(null);

    try {
      const res = await fetch("/api/welcome/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          display_name: displayName.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      if (data.mode === "existing") {
        setExistingNotice(
          data.emailSent
            ? "You already have a Melori account for this email. We've sent a link to set your password and finish activating your membership — check your inbox."
            : "You already have a Melori account for this email. Please sign in, or use “Forgot password” to set a new one.",
        );
        return;
      }

      // Freshly created account — sign in with the password we just set, then
      // route by tier.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: info.email ?? "",
        password,
      });
      if (signInError) {
        setExistingNotice(
          "Your account is ready. Please sign in to continue.",
        );
        return;
      }

      // Paid-first referral handoff: register/page.tsx stashes ?ref= in
      // localStorage for paid tiers (no session existed at signup time). Now
      // that this freshly-created account is signed in, drain and apply it.
      // Best-effort — never block the redirect.
      try {
        const stashedRef =
          typeof window !== "undefined"
            ? localStorage.getItem("melori_ref")
            : null;
        if (stashedRef) {
          localStorage.removeItem("melori_ref");
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (token) {
            await fetch("/api/referrals/apply", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ code: stashedRef }),
            });
          }
        }
      } catch {
        /* best-effort referral apply */
      }

      router.push(data.artist ? "/studio" : "/social/spaces");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-center text-text-secondary">Verifying your purchase…</p>;
  }

  if (loadError === "missing") {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-3">Nothing to set up here</h1>
        <p className="text-text-secondary mb-6">
          This page is for finishing account setup after a purchase.
        </p>
        <Link
          href="/membership"
          className="inline-block px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
        >
          View memberships
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-3">We couldn&apos;t verify that</h1>
        <p className="text-text-secondary mb-6">{loadError}</p>
        <Link
          href="/membership"
          className="inline-block px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
        >
          Back to memberships
        </Link>
      </div>
    );
  }

  const tier = info?.tier ?? null;
  const isArtist = tier === "artist";

  if (existingNotice) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-3">Almost there</h1>
        <p className="text-text-secondary mb-6">{existingNotice}</p>
        <Link
          href="/social/auth"
          className="inline-block px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-primary mb-2">
          {tierLabel(tier)} membership
        </p>
        <h1 className="text-3xl font-bold mb-2">Welcome to Melori</h1>
        <p className="text-text-secondary">
          Your payment went through. Set up your account to activate your
          membership{isArtist ? " and open your studio" : ""}.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-text-secondary">
            Email
          </label>
          <input
            type="email"
            value={info?.email ?? ""}
            readOnly
            disabled
            className="w-full bg-brand-muted/60 border border-brand-border rounded-xl px-4 py-3 text-sm text-text-secondary cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-text-secondary">
            Display name
          </label>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={isArtist ? "Your artist name" : "How should we call you?"}
            className="w-full bg-brand-surface border border-input-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand-primary transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-text-secondary">
            Password
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full bg-brand-surface border border-input-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand-primary transition"
          />
        </div>

        {formError && (
          <p className="text-red-400 text-sm bg-red-500/10 p-3 rounded-xl">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-6 py-3.5 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white disabled:opacity-50"
        >
          {submitting ? "Setting up…" : "Activate my membership"}
        </button>
      </form>

      <p className="text-center text-xs text-text-secondary mt-6">
        Already have an account?{" "}
        <Link href="/social/auth" className="text-brand-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
