"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Mail } from "lucide-react";

// /forgot-password — request a Supabase password-reset email. The recovery link
// lands on /reset-password (which finishes the flow via updateUser). Email is
// delivered by Supabase Auth SMTP / the project's configured provider — no
// Cloudflare. We always show the same success message so we don't reveal
// whether an email is registered.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/reset-password`
          : undefined;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo },
      );
      if (resetError) throw resetError;
      setSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not send the reset email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-widest text-[#c9a96e]">Account</p>
          <h1 className="text-3xl font-bold mt-1">Reset your password</h1>
          <p className="text-sm text-[#888] mt-1">
            We&apos;ll email you a secure link to set a new password.
          </p>
        </div>

        {sent ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-emerald-400">
              If an account exists for that email, a reset link is on its way.
              Check your inbox (and spam).
            </p>
            <Link
              href="/social/auth"
              className="mt-5 inline-block px-6 py-2.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-[#888]" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full bg-black/60 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#c9a96e] transition"
              />
            </div>
            {error && (
              <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-semibold text-sm disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <p className="text-center text-sm text-[#888]">
              Remembered it?{" "}
              <Link href="/social/auth" className="text-[#c9a96e] hover:underline font-medium">
                Sign In
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
