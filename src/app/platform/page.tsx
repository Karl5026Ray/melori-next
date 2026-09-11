"use client";

// The door — the first thing a signed-out visitor sees.
//
// Served at melorimusic.org/ (signed out) and melori.org/ via the rewrites in
// src/proxy.ts. A signed-in visitor never reaches it: the proxy sends them
// straight to the app, and the session check below catches the one case the
// proxy cannot see.
//
// WHY THE HAND-OFF EXISTS
// -----------------------
// Supabase session cookies are host-scoped, so a session created on melori.org
// does NOT carry over to melorimusic.org. The account is created here — a
// Supabase API call, which is host-independent — and then the user is handed
// off to the app domain, where the session actually gets established:
//   • email confirmation ON  → the confirmation link lands on
//                              melorimusic.org/auth/callback and signs them in
//   • email confirmation OFF → a "Continue to Melori" button to the app's login
//
// PHONE IS REQUIRED, AND THE VERIFY STEP IS SELF-CONFIGURING
// ----------------------------------------------------------
// Melori is a live-participation community — people appear on camera in Faces,
// Mirror, Spaces and Cinema — so every account is tied to a real number.
//
// There is no feature flag. The page asks /api/auth/phone/start and reads the
// answer: 503 { configured: false } means Telnyx is not wired up or A2P 10DLC
// has not cleared, so the number is stored and signup completes without a code;
// 200 means a code went out and the verify step appears. The door tightens by
// itself the moment verification starts working, with nothing to remember to
// flip.
//
// Nothing here may link into the native app's world — melori.org is not in
// mobile/capacitor.config.json allowNavigation.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const APP_ORIGIN = "https://melorimusic.org";
const AFTER_SIGNUP = "/social/discover";

// The hero lives in Supabase Storage, not /public.
//
// It used to be two files under /public that were never actually committed, so
// `/melori-header.jpg` and `/melori-header-mobile.jpg` had always 404'd and the
// door rendered its alt text as broken-image text. Since the proxy started
// sending every signed-out visitor here, that was the first thing anyone saw of
// Melori.
//
// Storage rather than /public so the hero can be swapped from the Supabase
// dashboard without a commit and a redeploy — this page is the front of the
// funnel, and changing its photo should not require shipping code. The `images`
// bucket is public and already holds the release covers; site chrome goes under
// a `site/` prefix so it never collides with an artist slug.
const SITE_ASSET_BASE = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/images/site`;
const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

const HEADER_IMAGE = hasSupabaseUrl ? `${SITE_ASSET_BASE}/melori-header.jpg` : "";
const HEADER_IMAGE_MOBILE = hasSupabaseUrl
  ? `${SITE_ASSET_BASE}/melori-header-mobile.jpg`
  : "";
const LOGO = "/logo/logo.png";

type Phase = "form" | "verify" | "confirm" | "ready";
type VerifyChannel = "sms" | "call";

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

export default function MeloriDoorPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<VerifyChannel>("call");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [resending, setResending] = useState(false);
  // A missing or slow-to-upload hero must never render as broken alt text
  // again; it falls back to the brand gradient below.
  const [heroFailed, setHeroFailed] = useState(false);

  // A member who is already signed in has no business on the door.
  //
  // The proxy decides who lands here from an `sb-*-auth-token` COOKIE. WebKit's
  // ITP caps script-written cookies at 7 days regardless of the Max-Age we ask
  // for (see supabaseCookieStorage.ts), so an iOS member can hold a perfectly
  // live session in the localStorage mirror with no cookie left — and the proxy
  // would send them here. getSession() reads the mirror too, so this catches
  // exactly that case and forwards them on. Cost of an evicted cookie: one
  // redirect, not a login.
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) router.replace("/music");
    });
    return () => {
      active = false;
    };
  }, [router]);

  const emailRedirectTo = `${APP_ORIGIN}/auth/callback?next=${encodeURIComponent(AFTER_SIGNUP)}`;

  const handleResend = async () => {
    setResending(true);
    setError("");
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo },
      });
      if (resendError) throw resendError;
    } catch (err: any) {
      setError(err?.message ?? "Could not resend the confirmation email.");
    } finally {
      setResending(false);
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
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role: "free", phone: e164 }, emailRedirectTo },
      });
      if (signUpError) throw signUpError;

      const session = data.session;

      // No session means email confirmation is required. The phone routes need
      // an authenticated caller, so verification waits until they are signed in
      // on the app domain. The number is already on the account metadata.
      if (!session) {
        setPhase("confirm");
        setLoading(false);
        return;
      }

      // Seed the profile row while a token is in hand. /api/* is excluded from
      // the proxy matcher, so this resolves against the same deployment on
      // either host.
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
        /* seeded on the next authed request */
      }

      const verificationChannel = await startPhoneVerification(session.access_token, e164);
      if (verificationChannel) setChannel(verificationChannel);
      setPhase(verificationChannel ? "verify" : "ready");
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
      if (!token) throw new Error("Your session expired. Sign in on Melori to finish.");

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

      setPhase("ready");
      setLoading(false);
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
      {/* Header image — full bleed, faded into the page */}
      <div className="relative w-full overflow-hidden">
        {HEADER_IMAGE && !heroFailed ? (
          <picture>
            <source media="(max-width: 639px)" srcSet={HEADER_IMAGE_MOBILE} />
            <img
              src={HEADER_IMAGE}
              alt="Melori creators in a studio session"
              /* Faces sit high in the frame — bias the crop upward so a short
                 viewport never cuts them off at the chin. */
              style={{ objectPosition: "center 34%" }}
              /* Two paths, because one is not enough. `onError` catches a
                 failure that happens after React is listening. But this page is
                 server-rendered, so the browser starts fetching the hero long
                 before hydration — a 404 usually lands in that gap and its
                 error event is gone by the time React attaches. The ref catches
                 exactly that case: an <img> that has finished ("complete") with
                 nothing decoded (naturalWidth 0) has already failed. */
              ref={(el) => {
                if (el && el.complete && el.naturalWidth === 0) setHeroFailed(true);
              }}
              onError={() => setHeroFailed(true)}
              className="h-[40vh] max-h-[440px] min-h-[240px] w-full object-cover"
            />
          </picture>
        ) : (
          /* No photo yet, or it failed to load. Hold the exact same box so the
             masthead below stays put, and fill it with the brand gradient
             rather than a broken-image icon. */
          <div
            aria-hidden="true"
            className="h-[40vh] max-h-[440px] min-h-[240px] w-full bg-[radial-gradient(ellipse_at_50%_20%,#2a2113_0%,#141210_45%,#0a0a0a_100%)]"
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-[#0a0a0a]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/70 to-transparent" />

        {/* Brand lockup — straddles the photo and the fade, so it never fights
            the image for contrast and reads as the page's masthead. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex items-center justify-center gap-3 sm:bottom-6 sm:gap-4">
          <img
            src={LOGO}
            alt=""
            aria-hidden="true"
            className="h-11 w-11 drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)] sm:h-14 sm:w-14"
          />
          {/* -mr compensates for the trailing letter-space so the lockup
              optically centers rather than sitting a hair left. */}
          <span className="-mr-[0.3em] text-2xl font-bold tracking-[0.3em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] sm:text-4xl">
            MELORI
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 pb-16 pt-8">
        <div className="relative text-center">
          <h1 className="text-3xl font-bold leading-tight">Create your account</h1>
          <p className="mt-2 text-sm text-[#888]">
            All the music, free to every member. Live rooms, cinema nights, and a
            room full of creators &mdash; your catalog opens the moment you sign in.
          </p>
        </div>

        {error && (
          <p className="mt-6 rounded-xl bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
        )}

        {phase === "form" && (
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
              type="tel"
              required
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Mobile number"
              className={inputClass}
            />
            <p className="-mt-1 px-1 text-xs leading-relaxed text-[#7a7a7a]">
              Required. Melori is a live community &mdash; people go on camera here,
              so every account is tied to a real number. Yours is never shown on
              your profile and never shared.
            </p>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 6 characters)"
              className={inputClass}
            />
            <button type="submit" disabled={loading} className={ctaClass}>
              {loading ? "Creating…" : "Create free account"}
            </button>
          </form>
        )}

        {phase === "verify" && (
          <form onSubmit={handleVerify} className="mt-8 space-y-4">
            <p className="text-center text-sm text-[#ddd]">
              {channel === "call" ? (
                <>
                  We&apos;re calling <span className="text-[#c9a96e]">{phone}</span> now.
                  Answer and a voice will read you a 6-digit code.
                </>
              ) : (
                <>
                  We texted a code to <span className="text-[#c9a96e]">{phone}</span>.
                </>
              )}
            </p>
            <input
              type="text"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Verification code"
              className={`${inputClass} text-center text-lg tracking-[0.4em]`}
            />
            <button type="submit" disabled={loading} className={ctaClass}>
              {loading ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
        )}

        {phase === "confirm" && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-[#ddd]">
              Almost there &mdash; we sent a confirmation link to{" "}
              <span className="text-[#c9a96e]">{email}</span>.
            </p>
            <p className="mt-2 text-xs text-[#888]">
              Click it and you&apos;ll land on Melori, signed in. Check spam if it
              hasn&apos;t arrived in a minute.
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="mt-4 inline-flex items-center rounded-lg border border-[#c9a96e]/40 px-3 py-1.5 text-xs font-medium text-[#c9a96e] transition hover:bg-[#c9a96e]/10 disabled:opacity-50"
            >
              {resending ? "Resending…" : "Resend confirmation email"}
            </button>
          </div>
        )}

        {phase === "ready" && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-[#ddd]">
              You&apos;re in. Head over to Melori and sign in to start listening.
            </p>
            <a
              href={`${APP_ORIGIN}/login?email=${encodeURIComponent(email)}`}
              className="mt-4 inline-block w-full rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] py-3 text-sm font-semibold text-[#0a0a0a]"
            >
              Continue to Melori &rarr;
            </a>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-[#888]">
          Already have an account?{" "}
          <a
            href={`${APP_ORIGIN}/login`}
            className="font-medium text-[#c9a96e] hover:underline"
          >
            Sign In
          </a>
        </p>

        <p className="mt-8 text-center text-[11px] leading-relaxed text-[#5f5f5f]">
          By creating an account you agree to Melori&apos;s{" "}
          <a href={`${APP_ORIGIN}/terms`} className="underline hover:text-[#888]">
            Terms
          </a>{" "}
          and{" "}
          <a href={`${APP_ORIGIN}/privacy`} className="underline hover:text-[#888]">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
