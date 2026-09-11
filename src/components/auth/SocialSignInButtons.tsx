"use client";

import { useEffect, useRef, useState } from "react";
import { startOAuthSignIn } from "@/lib/nativeAuth";

// "Continue with Google" / "Continue with Apple" for the join pages
// (Karl, 2026-09-10). The same OAuth path the sign-in page already uses, so a
// new visitor gets an account and a returning member just signs in.
//
// melori.org: an OAuth sign-in has to START on the app's own domain. The
// PKCE verifier is saved in the browser for the domain that begins the
// sign-in, and the provider returns to melorimusic.org — a sign-in started on
// melori.org would come back to a domain that never saw the verifier and
// fail. So on melori.org the buttons hand off to melorimusic.org/register
// with ?start=google|apple, and that page begins the sign-in immediately.

type Provider = "google" | "apple";

const APP_ORIGIN = "https://melorimusic.org";

function onDoorOnlyHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host === "melori.org" || host === "www.melori.org";
}

function GoogleG() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 384 512" className="h-5 w-5 fill-current">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

export default function SocialSignInButtons({
  next,
  autoStart,
  onError,
}: {
  /** Where to land after sign-in. Must already be a safe in-app path. */
  next: string;
  /** Begin this provider's sign-in as soon as the buttons mount (melori.org hand-off). */
  autoStart?: Provider | null;
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const autoStarted = useRef(false);

  const start = async (provider: Provider) => {
    if (busy) return;
    if (onDoorOnlyHost()) {
      window.location.href = `${APP_ORIGIN}/register?start=${provider}&next=${encodeURIComponent(next)}`;
      return;
    }
    setBusy(provider);
    try {
      // Same PKCE callback page the sign-in screen uses (/auth/callback).
      await startOAuthSignIn(provider, `next=${encodeURIComponent(next)}`);
    } catch (err: any) {
      setBusy(null);
      onError?.(err?.message ?? `${provider === "google" ? "Google" : "Apple"} sign-in failed.`);
    }
  };

  useEffect(() => {
    if (!autoStart || autoStarted.current || onDoorOnlyHost()) return;
    autoStarted.current = true;
    void start(autoStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const base =
    "w-full flex items-center justify-center gap-3 rounded-full py-3 text-sm font-semibold transition disabled:opacity-60";

  return (
    <div className="space-y-3" data-testid="social-sign-in">
      <button
        type="button"
        onClick={() => void start("google")}
        disabled={busy !== null}
        className={`${base} bg-white text-[#1f1f1f] hover:bg-white/90`}
      >
        <GoogleG />
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </button>
      <button
        type="button"
        onClick={() => void start("apple")}
        disabled={busy !== null}
        /* Apple's guidelines: on a dark page use the white button, not black. */
        className={`${base} bg-white text-black hover:bg-white/90`}
      >
        <AppleLogo />
        {busy === "apple" ? "Opening Apple…" : "Continue with Apple"}
      </button>
    </div>
  );
}
