"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// /register — the canonical signup surface.
//   • Free Fan  → create the Supabase account immediately (role "free").
//   • Superfan / Artist → route into the existing Stripe flow on /membership;
//     the account + paid role are granted after payment via the /welcome flow
//     (post-payment) and the members Stripe webhook. We never grant a paid role
//     client-side without payment.
// One auth system (Supabase). Google sign-in offered for the free path.

const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;

type Tier = "free" | "superfan" | "artist";

const TIERS: { id: Tier; name: string; price: string; blurb: string }[] = [
  { id: "free", name: "Free Fan", price: "$0", blurb: "Stream music, join the community." },
  { id: "superfan", name: "Superfan", price: "$2.99/mo", blurb: "Early access, exclusives, HD audio." },
  { id: "artist", name: "Artist", price: "$4.99/mo", blurb: "Upload, analytics, payouts, studio, keep 90%." },
];

function RegisterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/social/spaces";

  const [tier, setTier] = useState<Tier>("free");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const handleGoogle = async () => {
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
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");

    // Paid tiers go through Stripe — send the user to /membership where the
    // live Payment Links start Checkout → /welcome grants the role after pay.
    if (tier !== "free") {
      router.push("/membership");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    const normalizedUsername = username.trim().toLowerCase();
    if (!USERNAME_RE.test(normalizedUsername)) {
      setError(
        "Username must be 3–30 chars: lowercase letters, numbers, underscore or dot.",
      );
      return;
    }

    setLoading(true);
    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: normalizedUsername,
            role: "free",
            display_name: normalizedUsername,
          },
        },
      });
      if (signUpError) throw signUpError;

      // Email confirmation on → no session yet. Tell the user to check email.
      if (!signUpData.session) {
        setNotice("Check your email to confirm your account, then sign in.");
        setLoading(false);
        return;
      }

      // Best-effort seed of the profiles row (service-role endpoint). Never
      // block the redirect on it — it can be seeded on the next auth'd request.
      try {
        const accessToken = signUpData.session?.access_token;
        if (accessToken) {
          await fetch("/api/social/profile/init", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ username: normalizedUsername, role: "free" }),
          });
        }
      } catch {
        /* seeded later */
      }

      router.push(next);
    } catch (err: any) {
      setError(err?.message ?? "Could not create your account.");
      setLoading(false);
    }
  };

  const paid = tier !== "free";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-widest text-[#c9a96e]">Join Melori</p>
          <h1 className="text-3xl font-bold mt-1">Create your account</h1>
          <p className="text-sm text-[#888] mt-1">Pick a plan to get started.</p>
        </div>

        {/* Tier picker */}
        <div className="grid gap-3 mb-6">
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTier(t.id)}
              className={`text-left rounded-2xl border p-4 transition ${
                tier === t.id
                  ? "border-[#c9a96e] bg-[#c9a96e]/10"
                  : "border-white/10 bg-white/[0.02] hover:border-[#c9a96e]/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{t.name}</span>
                <span className="text-sm text-[#c9a96e]">{t.price}</span>
              </div>
              <p className="text-xs text-[#888] mt-1">{t.blurb}</p>
            </button>
          ))}
        </div>

        {notice && (
          <p className="mb-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">
            {notice}
          </p>
        )}
        {error && (
          <p className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </p>
        )}

        {paid ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-center">
            <p className="text-sm text-[#bbb]">
              {tier === "artist" ? "Artist" : "Superfan"} membership is set up
              through secure Stripe checkout. After payment you&apos;ll finish
              creating your account.
            </p>
            {tier === "artist" && (
  <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left">
    <p className="text-sm font-medium text-[#f0d99c]">
      After you join, set up payouts to get paid
    </p>
    <p className="mt-1 text-xs text-[#888]">
      Artists keep 90% of every sale. Once your account is created,
      head to Artist Studio &rarr; Payouts to connect Stripe. Have these
      ready:
    </p>
    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#bbb]">
      <li>A government-issued photo ID to verify your identity.</li>
      <li>Your date of birth and home address.</li>
      <li>Your bank account and routing numbers (or a debit card).</li>
      <li>For US taxes: your SSN (or EIN for a business).</li>
    </ul>
    <p className="mt-2 text-xs text-[#7a8a80]">
      You enter this on Stripe&apos;s secure page &mdash; Melori never sees
      or stores your ID or bank details.
    </p>
  </div>
)}
            <button
              type="button"
              onClick={() => router.push("/membership")}
              className="mt-4 w-full py-3 rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-semibold text-sm"
            >
              Continue to checkout
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-3 text-sm font-medium transition hover:border-[#c9a96e]/40 mb-4"
            >
              Continue with Google
            </button>
            <div className="flex items-center gap-3 mb-4">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-[#888]">or</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#c9a96e] transition"
              />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#c9a96e] transition"
              />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 6 chars)"
                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#c9a96e] transition"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-semibold text-sm disabled:opacity-50"
              >
                {loading ? "Creating…" : "Create free account"}
              </button>
            </form>
          </>
        )}

        <p className="text-center text-sm text-[#888] mt-6">
          Already have an account?{" "}
          <Link href="/social/auth" className="text-[#c9a96e] hover:underline font-medium">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a]" />}>
      <RegisterInner />
    </Suspense>
  );
}
