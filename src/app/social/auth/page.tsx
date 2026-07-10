"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Music, Mail, Lock, ArrowRight } from "lucide-react";

// Login gateway (Supabase). Account creation now lives at /register (tier
// picker + Stripe flow) so this page stays a single, focused sign-in surface.
// Honors ?next= so protected pages (settings/dashboard/superfan) return the
// user where they were headed.
function safeNext(next: string | null): string {
  // Only allow same-origin absolute paths to avoid open-redirects.
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/social/profile";
}

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

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
          ? `${window.location.origin}${next}`
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
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-melori-border bg-melori-elevated py-3 text-sm font-medium transition hover:border-melori-purple/40 disabled:opacity-50 mb-4"
        >
          {googleLoading ? "Redirecting\u2026" : "Continue with Google"}
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

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <AuthInner />
    </Suspense>
  );
}
