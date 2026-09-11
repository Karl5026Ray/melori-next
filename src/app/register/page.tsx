"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useIsNativeApp } from "@/components/NativeAppProvider";
import { supabase } from "@/lib/supabase";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";
import { safeNextPath } from "@/lib/mediaSetupMarker";

// /register — the canonical signup surface.
//
// ACCOUNT FIRST. NOTHING ELSE.
// ----------------------------
// This page used to open with a four-card membership grid (Free / Superfan /
// Artist) and only reveal the email + password fields underneath it.
// That made "create an account" look like "choose what to buy", which is the
// wrong first impression for a platform whose whole value is the community —
// and it put a price table in front of a visitor before they had any reason to
// care. Signing up is now one thing: email and password. Every account is
// created as role "free".
//
// NO PHONE, NO CAMERA STEP AT SIGNUP (Karl, 2026-09-10)
// -----------------------------------------------------
// "Hold off on the phone number addition until a person wants to go live."
// Listening, browsing, chatting: email + password is enough. The phone check
// and the one-time camera/microphone question move to the moment someone goes
// live, which is where the risk they protect against actually is. The phone
// routes (/api/auth/phone/*) and the media setup card are kept for that step.
//
// One auth system (Supabase). Continue with Google / Apple sits above the
// form (SocialSignInButtons). ?start=google|apple begins that sign-in on load:
// the melori.org door hands off here, because an OAuth sign-in has to start on
// the app's own domain.

type Phase = "form" | "confirm";

function RegisterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const isNativeApp = useIsNativeApp();
  // Single source of truth for redirect validation. This page used to carry its
  // own weaker prefix check, which let `/\evil.example` through — the two must
  // not be allowed to drift, so there is only one implementation now.
  const next = safeNextPath(params.get("next"));
  const startParam = params.get("start");
  const autoStart = startParam === "google" || startParam === "apple" ? startParam : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  // When email confirmation is required, we hold the address here so the user
  // can resend the confirmation link without retyping / re-submitting.
  const [pendingEmail, setPendingEmail] = useState("");
  const [resending, setResending] = useState(false);

  const emailRedirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : undefined;

  const finishSignup = () => {
    // Straight to where they were going. The camera/microphone question is
    // asked when they first go live, not here.
    router.push(next);
  };

  const handleResendConfirmation = async () => {
    if (!pendingEmail) return;
    setResending(true);
    setError("");
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: pendingEmail,
        options: { emailRedirectTo },
      });
      if (resendError) throw resendError;
      setNotice(`Confirmation link re-sent to ${pendingEmail}. Check your inbox and spam folder.`);
    } catch (err: any) {
      setError(err?.message ?? "Could not resend the confirmation email.");
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");

    // 8 matches Settings → Change password and the reset-password page, so a
    // password accepted here is never rejected later.
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role: "free" },
          emailRedirectTo,
        },
      });
      if (signUpError) throw signUpError;

      // Determine the active session. With email confirmation OFF (instant
      // signup) supabase returns a session directly. If it doesn't (e.g. a
      // brief propagation gap, or confirmation is ON), try an immediate
      // password sign-in — when the account is auto-confirmable this logs the
      // user straight in with no email step.
      let session = signUpData.session;
      if (!session) {
        const { data: signInData } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        session = signInData.session ?? null;
      }

      // Still no session → email confirmation is genuinely required.
      if (!session) {
        setPendingEmail(email);
        setPhase("confirm");
        setNotice(
          "Almost there — we sent a confirmation link to " +
            email +
            ". Click it to activate your account, then sign in. Didn't get it? Check spam or resend below.",
        );
        setLoading(false);
        return;
      }

      // Best-effort seed of the profiles row (service-role endpoint). Never
      // block on it — it can be seeded on the next auth'd request.
      try {
        await fetch("/api/social/profile/init", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ role: "free" }),
        });
      } catch {
        /* seeded later */
      }

      finishSignup();
    } catch (err: any) {
      setError(err?.message ?? "Could not create your account.");
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm transition focus:border-[#c9a96e] focus:outline-none";
  const ctaClass =
    "w-full rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] py-3 text-sm font-semibold text-[#0a0a0a] transition disabled:opacity-50";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-widest text-[#c9a96e]">Join Melori</p>
          <h1 className="text-3xl font-bold mt-1">Create your account</h1>
          <p className="text-sm text-[#888] mt-1">Google, Apple, or email. That&apos;s it.</p>
        </div>

        {notice && (
          <div className="mb-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">
            <p>{notice}</p>
            {pendingEmail && (
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resending}
                className="mt-2 inline-flex items-center rounded-lg border border-emerald-400/40 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50"
              >
                {resending ? "Resending…" : "Resend confirmation email"}
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </p>
        )}

        {phase === "confirm" ? null : (
          <>
            <div className="mb-4">
              <SocialSignInButtons next={next} autoStart={autoStart} onError={setError} />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-[#888]">or</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className={inputClass}
              />
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 8 characters)"
                className={inputClass}
              />
              <button type="submit" disabled={loading} className={ctaClass}>
                {loading ? "Creating…" : "Create account"}
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
        <p className="text-center text-xs text-[#666] mt-2">
          <Link href="/forgot-password" className="hover:text-[#c9a96e] hover:underline">
            Forgot your password?
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
