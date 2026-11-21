"use client";

import { useEffect, useState } from "react";
import {
  MOROCCO_ALBUMS,
  isSessionId,
  parseTier,
  tierGifts,
  type MoroccoTier,
} from "@/lib/moroccoGift";

const inputClass =
  "w-full rounded-lg border border-input-border bg-brand-muted px-3 py-3 text-base text-text-primary placeholder:text-text-secondary/60 focus:border-brand-primary focus:outline-none";
const card = "rounded-xl border border-brand-border bg-brand-surface p-5";
const primaryBtn =
  "w-full rounded-lg bg-brand-primary px-4 py-3 font-semibold text-white disabled:opacity-60";
const secondaryBtn =
  "w-full rounded-lg border border-brand-border px-4 py-3 font-semibold text-text-primary";

type Step = "ask" | "form" | "saved" | "skipped";

// Karl: ask first, never frighten people. The address is a choice offered
// AFTER payment, with a clear "No thanks" that stores nothing.
export default function MoroccoThankYou() {
  const [tier, setTier] = useState<MoroccoTier | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("ask");
  const [f, setF] = useState({
    full_name: "", line1: "", line2: "", city: "", state: "", postal_code: "",
    country: "US", note: "", company: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      setTier(parseTier(q.get("tier")));
      const s = q.get("session_id");
      setSessionId(isSessionId(s) ? s : null);
    } catch {
      // ignore
    }
  }, []);

  const gifts = tierGifts(tier);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/morocco/gift-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, tier, stripe_session_id: sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save. Please try again.");
      setStep("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const mailedWhat = gifts.hardcover
    ? "signed Without The Blacks hardcover, postcard and signed print"
    : "postcard and signed print from Marrakech";

  return (
    <div className="space-y-6">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-primary mb-3">
          Karl & Blessing · Marrakech
        </p>
        <h1 className="text-3xl font-bold leading-tight mb-2">Thank you. 🙏🏾</h1>
        <p className="text-text-secondary">
          Every dollar goes toward Blessing&apos;s flight from Lagos and her e-visa. You just helped
          bring us together for Christmas.
        </p>
      </header>

      {gifts.album && (
        <section className={card}>
          <h2 className="font-semibold mb-1">
            {tier === "custom" ? "Gave $20 or more? Your 3 albums are ready" : "Your 3 albums are ready"}
          </h2>
          <p className="text-sm text-text-secondary mb-4">
            Three albums from Karl&apos;s label. Save this page or the links.
          </p>
          <ul className="space-y-3">
            {MOROCCO_ALBUMS.map((a) => (
              <li key={a.title} className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.cover}
                  alt={`${a.title} album cover`}
                  width={64}
                  height={64}
                  className="h-16 w-16 flex-none rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">{a.title}</p>
                  <p className="text-sm text-text-secondary">{a.artist}</p>
                </div>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-none rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Get it
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gifts.mailed && sessionId && (
        <section className={card}>
          {step === "ask" && (
            <>
              <h2 className="font-semibold mb-1">
                {tier === "custom" ? "Gave $50 or more? Want your gifts mailed?" : "Want your gifts mailed to you?"}
              </h2>
              <p className="text-sm text-text-secondary mb-4">
                Your {mailedWhat} ship in January after the trip. Sharing an address is completely
                optional. We only use it to mail your gift, and we never share it.
              </p>
              <div className="space-y-2">
                <button type="button" className={primaryBtn} onClick={() => setStep("form")}>
                  Yes, add my address
                </button>
                <button type="button" className={secondaryBtn} onClick={() => setStep("skipped")}>
                  No thanks
                </button>
              </div>
            </>
          )}

          {step === "form" && (
            <form onSubmit={submit} className="space-y-3">
              <h2 className="font-semibold">Where should we mail it?</h2>
              <input className={inputClass} placeholder="Name on the envelope" value={f.full_name} onChange={set("full_name")} autoComplete="name" required maxLength={100} />
              <input className={inputClass} placeholder="Street address" value={f.line1} onChange={set("line1")} autoComplete="address-line1" required maxLength={200} />
              <input className={inputClass} placeholder="Apt, suite (optional)" value={f.line2} onChange={set("line2")} autoComplete="address-line2" maxLength={200} />
              <div className="grid grid-cols-2 gap-3">
                <input className={inputClass} placeholder="City" value={f.city} onChange={set("city")} autoComplete="address-level2" required maxLength={100} />
                <input className={inputClass} placeholder="State" value={f.state} onChange={set("state")} autoComplete="address-level1" required maxLength={60} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input className={inputClass} placeholder="ZIP" value={f.postal_code} onChange={set("postal_code")} autoComplete="postal-code" required maxLength={20} />
                <select className={inputClass} value={f.country} onChange={set("country")} autoComplete="country">
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                </select>
              </div>
              <textarea className={inputClass} placeholder="A note for Karl & Blessing (optional)" value={f.note} onChange={set("note")} rows={2} maxLength={500} />
              <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.company} onChange={set("company")} />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button type="submit" className={primaryBtn} disabled={submitting}>
                {submitting ? "Saving…" : "Save my address"}
              </button>
              <button type="button" className={secondaryBtn} onClick={() => setStep("skipped")}>
                Never mind, skip it
              </button>
            </form>
          )}

          {step === "saved" && (
            <p className="text-center">Got it. Your gift will be in the mail in January. 📮</p>
          )}
          {step === "skipped" && (
            <p className="text-center text-text-secondary">
              No problem. If you change your mind, just text Karl.
            </p>
          )}
        </section>
      )}

      <section className="text-center space-y-2">
        <p className="text-sm text-text-secondary">Follow the trip free on Melori.</p>
        <a href="/morocco" className="text-brand-primary underline">Back to our story</a>
      </section>
    </div>
  );
}
