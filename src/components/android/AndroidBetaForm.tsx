"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/authClient";
import {
  COUNTRY_OPTIONS,
  MELORI_SENDER_ADDRESS,
  isGmail,
  isIPhoneUserAgent,
  isValidEmail,
  normalizeEmail,
  sanitizeSource,
} from "@/lib/androidBeta";

const inputClass =
  "w-full rounded-lg border border-input-border bg-brand-muted px-3 py-3 text-base text-text-primary placeholder:text-text-secondary/60 focus:border-brand-primary focus:outline-none";

export default function AndroidBetaForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState<string>("United States");
  const [countryOther, setCountryOther] = useState("");
  const [hasAndroid, setHasAndroid] = useState(false);
  const [company, setCompany] = useState(""); // honeypot
  const [source, setSource] = useState<string | null>(null);
  const [onIPhone, setOnIPhone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      setOnIPhone(isIPhoneUserAgent(navigator.userAgent));
      setSource(sanitizeSource(new URLSearchParams(window.location.search).get("src")));
    } catch {
      // ignore
    }
    // Prefill for signed-in visitors. Their Melori email may not be their Play
    // Store account, so it stays editable.
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

  const normalized = normalizeEmail(email);
  const showGmailHint = isValidEmail(normalized) && !isGmail(normalized);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidEmail(normalized)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!hasAndroid) {
      setError("Please confirm you have an Android phone.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/android-beta", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders().catch(() => ({}))) },
        body: JSON.stringify({
          email: normalized,
          name,
          country,
          country_other: countryOther,
          has_android: hasAndroid,
          source,
          company,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="rounded-xl border border-brand-primary/40 bg-brand-primary/10 p-5"
      >
        <h2 className="text-xl font-semibold mb-2">You&apos;re on the list.</h2>
        <p className="text-text-secondary">
          Within 24 hours you&apos;ll get an email from Melori with your install link. Look
          for it from <span className="text-text-primary font-medium">{MELORI_SENDER_ADDRESS}</span>.
        </p>
      </div>
    );
  }

  return (
    <div>
      {onIPhone && (
        <div className="mb-5 rounded-xl border border-brand-border bg-brand-surface p-4 text-sm text-text-secondary">
          Looks like you&apos;re on an iPhone. This beta is Android-only for now — thanks for
          your interest!
        </div>
      )}

      <form onSubmit={submit} noValidate className="space-y-5">
        <div>
          <label htmlFor="ab-email" className="block text-sm font-medium mb-1.5">
            Gmail on your Play Store <span className="text-brand-primary">*</span>
          </label>
          <input
            id="ab-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@gmail.com"
            className={inputClass}
          />
          {showGmailHint && (
            <p className="mt-1.5 text-xs text-brand-accent">
              This must be the Google account your Play Store uses. If that&apos;s this
              address, you&apos;re fine.
            </p>
          )}
          <details className="mt-2 text-sm text-text-secondary">
            <summary className="cursor-pointer text-brand-primary">
              How to find your Play Store account
            </summary>
            <ol className="mt-2 list-decimal pl-5 space-y-1">
              <li>Open the Play Store app.</li>
              <li>Tap your profile picture (top right).</li>
              <li>The email shown at the top is the one to use.</li>
            </ol>
          </details>
        </div>

        <div>
          <label htmlFor="ab-name" className="block text-sm font-medium mb-1.5">
            First name <span className="text-text-secondary font-normal">(optional)</span>
          </label>
          <input
            id="ab-name"
            type="text"
            autoComplete="given-name"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="ab-country" className="block text-sm font-medium mb-1.5">
            Country
          </label>
          <select
            id="ab-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={inputClass}
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {country === "Other" && (
            <div className="mt-2">
              <input
                aria-label="Your country"
                type="text"
                maxLength={80}
                value={countryOther}
                onChange={(e) => setCountryOther(e.target.value)}
                placeholder="Your country"
                className={inputClass}
              />
              <p className="mt-1.5 text-xs text-text-secondary">
                You&apos;re still on the list — we&apos;ll add your country.
              </p>
            </div>
          )}
        </div>

        {/* Honeypot: hidden from people, tempting to bots. */}
        <div aria-hidden="true" className="hidden">
          <label>
            Company
            <input
              tabIndex={-1}
              autoComplete="off"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
        </div>

        <label className="flex items-start gap-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            required
            checked={hasAndroid}
            onChange={(e) => setHasAndroid(e.target.checked)}
            className="mt-0.5 h-5 w-5 accent-[#ff5500]"
          />
          <span>
            I have an Android phone <span className="text-brand-primary">*</span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-brand-primary px-5 py-3 text-base font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-60"
        >
          {submitting ? "Joining…" : "Join the Android beta"}
        </button>
      </form>
    </div>
  );
}
