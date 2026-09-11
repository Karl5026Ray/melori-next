"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { registerGoLiveSetupOpener } from "@/lib/goLiveGate";
import { hasSeenMediaSetup } from "@/lib/mediaSetupMarker";
import { MediaSetupCard } from "@/components/onboarding/MediaSetupCard";

// The one-time go-live step (Karl, 2026-09-10).
//
// Mounted once in the root layout. It opens only when a go-live route answers
// "add your number first" (see src/lib/goLiveGate.server.ts): the first time a
// member starts a Faces live, starts a Space / Cinema, or raises a hand.
//
//   1. Mobile number. With Telnyx configured, a 6-digit code is delivered by a
//      phone call (or a text, once A2P 10DLC is approved) and checked here.
//      With Telnyx not configured, the number is saved and they go on.
//   2. Camera & microphone, asked once. This device remembers the answer; it is
//      never asked again here. Settings → Camera & microphone changes it.
//
// When they finish, the request they made is sent again automatically, so the
// Go Live / Raise hand they tapped simply goes through.

type Step = "phone" | "code" | "media";

export default function GoLiveSetupHost() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<"sms" | "call">("call");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolverRef = useRef<((finished: boolean) => void) | null>(null);

  const close = useCallback((finished: boolean) => {
    setOpen(false);
    setBusy(false);
    setError("");
    setCode("");
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(finished);
  }, []);

  useEffect(
    () =>
      registerGoLiveSetupOpener(
        () =>
          new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
            setStep("phone");
            setError("");
            setOpen(true);
          }),
      ),
    [],
  );

  // A sheet left open when the member navigates away must not leave the
  // original request waiting forever.
  useEffect(() => () => resolverRef.current?.(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, close]);

  const afterPhone = () => {
    if (hasSeenMediaSetup()) {
      close(true);
      return;
    }
    setBusy(false);
    setError("");
    setStep("media");
  };

  const submitPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/auth/phone/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.sent) {
        setChannel(body?.channel === "sms" ? "sms" : "call");
        setStep("code");
        setBusy(false);
        return;
      }
      // SMS verification not live yet: the number is saved, carry on.
      if (res.status === 503 && body?.stored) {
        afterPhone();
        return;
      }
      throw new Error(body?.error ?? "Could not save that number.");
    } catch (err: any) {
      setError(err?.message ?? "Could not save that number.");
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/auth/phone/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "That code didn't match.");
      afterPhone();
    } catch (err: any) {
      setError(err?.message ?? "Could not verify that code.");
      setBusy(false);
    }
  };

  if (!open) return null;

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white transition focus:border-[#c9a96e] focus:outline-none";
  const ctaClass =
    "w-full rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] py-3 text-sm font-semibold text-[#0a0a0a] transition disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="go-live-setup-heading"
      data-testid="go-live-setup"
    >
      {step === "media" ? (
        <div className="w-full max-w-md text-white">
          <MediaSetupCard continueLabel="Go live" onDone={() => close(true)} />
        </div>
      ) : (
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111] p-6 text-white shadow-2xl">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#c9a96e]/15 text-[#c9a96e]">
            <Radio className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 id="go-live-setup-heading" className="text-2xl font-bold">
            One step before you go live
          </h2>

          {step === "phone" ? (
            <form onSubmit={submitPhone} className="mt-4 space-y-4">
              <p className="text-sm text-[#9a9a9a]">
                Going live puts you on camera in front of the community. Add your
                mobile number once &mdash; it keeps the rooms real, it&apos;s never
                shown on your profile, and it&apos;s never shared.
              </p>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Mobile number"
                className={inputClass}
              />
              {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
              <button type="submit" disabled={busy} className={ctaClass}>
                {busy ? "Saving…" : "Continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="mt-4 space-y-4">
              <p className="text-sm text-[#9a9a9a]">
                {channel === "call" ? (
                  <>
                    We&apos;re calling <span className="text-[#c9a96e]">{phone}</span> now.
                    Answer and a voice will read you a 6-digit code &mdash; type it here.
                  </>
                ) : (
                  <>
                    We texted a code to <span className="text-[#c9a96e]">{phone}</span>.
                  </>
                )}
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={10}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Verification code"
                className={`${inputClass} text-center text-lg tracking-[0.4em]`}
              />
              {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
              <button type="submit" disabled={busy} className={ctaClass}>
                {busy ? "Checking…" : "Verify"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setError("");
                }}
                className="w-full text-center text-xs text-[#c9a96e] hover:underline"
              >
                Wrong number?
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => close(false)}
            disabled={busy}
            className="mt-4 w-full text-center text-sm text-[#888] hover:text-white disabled:opacity-50"
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
