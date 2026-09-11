"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useIsNativeApp } from "@/components/NativeAppProvider";
import { supabase } from "@/lib/supabase";
import { startOAuthSignIn } from "@/lib/nativeAuth";
import {
  hasSeenMediaSetup,
  postSignupDestination,
  safeNextPath,
} from "@/lib/mediaSetupMarker";

// /register — the canonical signup surface.
//
// ACCOUNT FIRST. NOTHING ELSE.
// ----------------------------
// This page used to open with a four-card membership grid (Free / Superfan /
// Artist) and only reveal the email + password fields underneath it.
// That made "create an account" look like "choose what to buy", which is the
// wrong first impression for a platform whose whole value is the community —
// and it put a price table in front of a visitor before they had any reason to
// care. Signing up is now one thing: email, password, phone. Every account is
// created as role "free".
//
// PHONE IS REQUIRED, AND THE VERIFY STEP IS SELF-CONFIGURING
// ----------------------------------------------------------
// Melori is a live-participation community — people appear on camera in Faces,
// Mirror, Spaces and Cinema. Accounts are free, so a phone number is the only
// thing standing between the rooms and a bot farm: one real number, one
// account.
//
// There is no feature flag. The page asks /api/auth/phone/start and reads the
// answer: 503 { configured: false } means Telnyx is not wired up or A2P 10DLC
// has not cleared, so the number is stored and signup completes without a code;
// 200 means a code went out and the verify step appears. The door tightens by
// itself the moment verification starts working. This mirrors /platform (the
// melori.org door) deliberately — two front doors, one rule.
//
// One auth system (Supabase). Google sign-in is offered for the web path.

/** Normalise to E.164. A bare 10-digit input is assumed US/Canada. */
function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!hasPlus && digits.length === 10) return `+1${digits}`;
  if (!hasPlus && digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (hasPlus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

type Phase = "form" | "verify" | "confirm";
type VerifyChannel = "sms" | "call";

function RegisterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const isNativeApp = useIsNativeApp();
  // Single source of truth for redirect validation. This page used to carry its
  // own weaker prefix check, which let `/\evil.example` through — the two must
  // not be allowed to drift, so there is only one implementation now.
  const next = safeNextPath(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<VerifyChannel>("call");
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
    // Newly created free account → offer the one-time camera/microphone setup
    // step before the page they were heading to. Once this device has been
    // through it, this is a no-op and they go straight to `next`.
    router.push(postSignupDestination(next, hasSeenMediaSetup()));
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

  const handleGoogle = async () => {
    setError("");
    try {
      // Route Google through the dedicated /auth/callback page, which runs
      // exchangeCodeForSession client-side (same store that holds the PKCE code
      // verifier). Redirecting straight to `next` skips the exchange and throws
      // "PKCE code verifier not found in storage".
      await startOAuthSignIn("google", `next=${encodeURIComponent(next)}`);
    } catch (err: any) {
      setError(err?.message ?? "Google sign-in failed.");
    }
  };

  /**
   * Returns the channel that delivered a code, or null when verification is
   * not available yet and signup should continue with an unverified number.
   */
  const startPhoneVerification = async (
    accessToken: string,
    e164: string,
  ): Promise<VerifyChannel | null> => {
    const res = await fetch("/api/auth/phone/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ phone: e164 }),
    });

    if (res.status === 503) return null; // Telnyx not configured
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      return body?.channel === "sms" ? "sms" : "call";
    }

    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? "Could not send a verification code.");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");

    const e164 = toE164(phone);
    if (!e164) {
      setError(
        "Enter a valid mobile number. US and Canada can use 10 digits; otherwise include your country code.",
      );
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role: "free", phone: e164 },
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

      // Still no session → email confirmation is genuinely required. The phone
      // routes need an authenticated caller, so verification waits until they
      // are signed in. The number is already on the account metadata.
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

      const verificationChannel = await startPhoneVerification(session.access_token, e164);
      if (!verificationChannel) {
        // Verification is not live yet — the number is on the account, and the
        // account is real. Let them in.
        finishSignup();
        return;
      }
      setChannel(verificationChannel);
      setPhase("verify");
      setLoading(false);
    } catch (err: any) {
      setError(err?.message ?? "Could not create your account.");
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in to finish verifying.");

      const res = await fetch("/api/auth/phone/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "That code didn't match.");

      finishSignup();
    } catch (err: any) {
      setError(err?.message ?? "Could not verify that code.");
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
          <p className="text-sm text-[#888] mt-1">
            {phase === "verify"
              ? channel === "call"
                ? "Answer the call and enter the 6-digit code it reads to you."
                : "Enter the code we texted you."
              : "Email, password, and a mobile number. That's it."}
          </p>
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

        {phase === "verify" ? (
          <form onSubmit={handleVerify} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              className={inputClass}
            />
            <button type="submit" disabled={loading} className={ctaClass}>
              {loading ? "Verifying…" : "Verify and continue"}
            </button>
            <p className="text-center text-xs text-[#888]">
              {channel === "call" ? "Calling" : "Texted to"} {phone}.{" "}
              <button
                type="button"
                onClick={() => {
                  setPhase("form");
                  setCode("");
                  setError("");
                }}
                className="text-[#c9a96e] hover:underline"
              >
                Wrong number?
              </button>
            </p>
          </form>
        ) : phase === "confirm" ? null : (
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
                placeholder="Password (min 6 chars)"
                className={inputClass}
              />
              <input
                type="tel"
                required
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Mobile number"
                className={inputClass}
              />
              <p className="text-xs text-[#7a8a80]">
                Melori is live video and audio. Your number keeps the rooms real —
                one person, one account. We never show it and never sell it.
              </p>
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
