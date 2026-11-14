"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/authClient";
import {
  OPEN_LETTER_ROOM_PATH,
  formatSignatureCount,
  normalizeEmail,
  sanitizeSource,
} from "@/lib/openLetter";

const inputClass =
  "w-full rounded-lg border border-input-border bg-brand-muted px-3 py-3 text-base text-text-primary placeholder:text-text-secondary/60 focus:border-brand-primary focus:outline-none";

// Signature form for /open-letter. The count is fetched on the client so the
// page itself stays static (no-store breaks the iOS app; see tasks/lessons.md).
export default function OpenLetterForm() {
  const [firstName, setFirstName] = useState("");
  const [cityState, setCityState] = useState("");
  const [email, setEmail] = useState("");
  const [hasPartner, setHasPartner] = useState(false);
  const [story, setStory] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [source, setSource] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function loadCount() {
    try {
      const res = await fetch("/api/open-letter", { cache: "no-store" });
      const data = await res.json();
      if (typeof data?.count === "number") setCount(data.count);
    } catch {
      // count is decoration; never block signing on it
    }
  }

  useEffect(() => {
    try {
      setSource(sanitizeSource(new URLSearchParams(window.location.search).get("src")));
    } catch {
      // ignore
    }
    loadCount();
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        const signedIn = data.session?.user?.email;
        if (!cancelled && signedIn) setEmail((cur) => cur || signedIn);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim()) return setError("Please enter your first name.");
    if (cityState.trim().length < 2) return setError("Please enter your city and state.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(email))) {
      return setError("Please enter a valid email address.");
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/open-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders().catch(() => ({}))) },
        body: JSON.stringify({
          first_name: firstName,
          city_state: cityState,
          email: normalizeEmail(email),
          has_partner_in_process: hasPartner,
          story,
          source,
          company,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
        return;
      }
      loadCount();
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const countLine =
    count !== null && count > 0 ? (
      <p className="text-sm text-brand-primary font-semibold mb-4" data-testid="ol-count">
        {formatSignatureCount(count)}
      </p>
    ) : null;

  if (done) {
    return (
      <div role="status" className="rounded-xl border border-brand-primary/40 bg-brand-primary/10 p-5">
        {countLine}
        <h2 className="text-xl font-semibold mb-2">Thank you. Your name is on the letter.</h2>
        <p className="text-text-secondary mb-4">
          Your name is never shown publicly. Now come talk with other couples going through
          this.
        </p>
        <Link
          href={OPEN_LETTER_ROOM_PATH}
          className="block w-full rounded-lg bg-brand-primary px-4 py-3 text-center font-semibold text-white"
        >
          Join the conversation in MM Spaces
        </Link>
        <p className="mt-3 text-xs text-text-secondary">
          Melori is free to join. Please don&apos;t share case numbers or documents in the room,
          and never pay anyone who messages you offering visa help.
        </p>
      </div>
    );
  }

  return (
    <div>
      {countLine}
      <form onSubmit={submit} noValidate className="space-y-5">
        <div>
          <label htmlFor="ol-first" className="block text-sm font-medium mb-1.5">
            First name <span className="text-brand-primary">*</span>
          </label>
          <input
            id="ol-first"
            type="text"
            autoComplete="given-name"
            maxLength={60}
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="ol-city" className="block text-sm font-medium mb-1.5">
            City and state <span className="text-brand-primary">*</span>
          </label>
          <input
            id="ol-city"
            type="text"
            autoComplete="address-level2"
            maxLength={100}
            required
            value={cityState}
            onChange={(e) => setCityState(e.target.value)}
            placeholder="Chicago, IL"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="ol-email" className="block text-sm font-medium mb-1.5">
            Email <span className="text-brand-primary">*</span>
          </label>
          <input
            id="ol-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-text-secondary">
            Only used to count you once and tell you when the letter is delivered.
          </p>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={hasPartner}
            onChange={(e) => setHasPartner(e.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>I&apos;m a U.S. citizen with a fiancé(e) or spouse waiting on a visa.</span>
        </label>

        <div>
          <label htmlFor="ol-story" className="block text-sm font-medium mb-1.5">
            Your story <span className="text-text-secondary font-normal">(optional, private)</span>
          </label>
          <textarea
            id="ol-story"
            rows={4}
            maxLength={1000}
            value={story}
            onChange={(e) => setStory(e.target.value)}
            placeholder="A few sentences lawmakers should hear. No case numbers or partner names, please."
            className={inputClass}
          />
        </div>

        {/* Honeypot: hidden from people, irresistible to bots. */}
        <div aria-hidden="true" className="hidden">
          <label>
            Company
            <input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand-primary px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "Signing…" : "Add my name"}
        </button>
        <p className="text-xs text-text-secondary">
          Your name is never shown publicly. We share only the total count, and deliver
          signatures to the lawmakers named in the letter.
        </p>
      </form>
    </div>
  );
}
