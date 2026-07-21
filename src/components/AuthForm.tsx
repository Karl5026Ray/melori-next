"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Music, Mail, Lock, ArrowRight } from "lucide-react";

// Shared Supabase login surface. Rendered by BOTH the /social/auth gateway and
// the top-level /login route so there is a single, canonical sign-in form
// (Google + Apple OAuth, email/password, forgot-password, sign-up link).
// Account creation lives at /register (tier picker + Stripe flow).
// Honors ?next= so protected pages (settings/dashboard/superfan) return the
// user where they were headed.
function safeNext(next: string | null): string {
  // Only allow same-origin absolute paths to avoid open-redirects.
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  // Default landing after sign-in is the main music catalog page.
  return "/music";
}

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState(params.get("error") ?? "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      router.push(next);
    } catch (err: any) {
      setError(err?.message ?? "Could not sign in.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError("");
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
          : undefined;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    } catch (err: any) {
      setError(err?.message ?? "Google sign-in failed.");
      setGoogleLoading(false);
    }
  };

  // Apple OAuth uses the SAME PKCE callback (/auth/callback) as Google so the
  // existing double-exchange-safe session handling applies unchanged. Requires
  // the Apple provider to be enabled in the Supabase project (Service ID + key).
  const handleApple = async () => {
    setAppleLoading(true);
    setError("");
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
          : undefined;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    } catch (err: any) {
      setError(err?.message ?? "Apple sign-in failed.");
      setAppleLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-melori-purple to-melori-pink flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Music className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-1">Welcome Back</h1>
          <p className="text-melori-muted text-sm">The OS for independent music</p>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={googleLoading || appleLoading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-melori-border bg-melori-elevated py-3 text-sm font-medium transition hover:border-melori-purple/40 disabled:opacity-50 mb-3"
        >
          {googleLoading ? "Redirecting\u2026" : "Continue with Google"}
        </button>

        <button
          type="button"
          onClick={handleApple}
          disabled={appleLoading || googleLoading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-melori-border bg-melori-elevated py-3 text-sm font-medium transition hover:border-melori-purple/40 disabled:opacity-50 mb-4"
        >
          {appleLoading ? (
            "Redirecting\u2026"
          ) : (
            <>
              <svg
                aria-hidden="true"
                viewBox="0 0 384 512"
                className="h-4 w-4 fill-current"
              >
                <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
              </svg>
              Continue with Apple
            </>
          )}
        </button>

        <div className="flex items-center gap-3 mb-4">
          <span className="h-px flex-1 bg-melori-border" />
          <span className="text-xs text-melori-muted">or</span>
          <span className="h-px flex-1 bg-melori-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-melori-muted" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full bg-melori-elevated border border-melori-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
            />
          </div>

          <div className="relative">
            <Lock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-melori-muted" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-melori-elevated border border-melori-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 p-3 rounded-xl">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? "Please wait..." : "Sign In"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link
            href="/forgot-password"
            className="text-sm text-melori-muted hover:text-melori-purple hover:underline"
          >
            Forgot your password?
          </Link>
        </div>

        <p className="text-center text-sm text-melori-muted mt-6">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="text-melori-purple hover:underline font-medium"
          >
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AuthForm() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <AuthInner />
    </Suspense>
  );
}
