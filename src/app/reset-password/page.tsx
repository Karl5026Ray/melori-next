"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// Set-a-new-password page. Reached from the Supabase recovery / invite link
// emailed by the /welcome flow and the artist-tester script (redirect_to points
// here). The Supabase browser client auto-detects the recovery tokens in the
// URL on load and establishes a temporary session; we then let the user set a
// password via auth.updateUser and send them to sign in.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) {
        setHasSession(true);
        setReady(true);
      }
    });

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setHasSession(!!data.session);
      setReady(true);
    })();

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setDone(true);
      await supabase.auth.signOut();
      setTimeout(() => router.push("/social/auth"), 1500);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-brand-background text-text-primary">
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-md mx-auto px-6 py-16">
          {!ready ? (
            <p className="text-center text-text-secondary">Loading…</p>
          ) : done ? (
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-3">Password set</h1>
              <p className="text-text-secondary mb-6">
                You&apos;re all set. Redirecting you to sign in…
              </p>
              <Link
                href="/social/auth"
                className="inline-block px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
              >
                Sign in
              </Link>
            </div>
          ) : !hasSession ? (
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-3">Link expired</h1>
              <p className="text-text-secondary mb-6">
                This password link is invalid or has expired. Request a new one
                from the sign-in page.
              </p>
              <Link
                href="/social/auth"
                className="inline-block px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold mb-2">Set your password</h1>
                <p className="text-text-secondary">
                  Choose a password to finish setting up your Melori account.
                </p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-text-secondary">
                    New password
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
                <div>
                  <label className="block text-sm font-medium mb-1 text-text-secondary">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    className="w-full bg-brand-surface border border-input-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand-primary transition"
                  />
                </div>
                {error && (
                  <p className="text-red-400 text-sm bg-red-500/10 p-3 rounded-xl">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full px-6 py-3.5 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white disabled:opacity-50"
                >
                  {submitting ? "Saving…" : "Set password"}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
