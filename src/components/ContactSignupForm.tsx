"use client";

import { useState } from "react";

// Free-tier contact capture. Open to everyone (no auth). Posts to
// /api/contact-signup which inserts via the service role key. At least one of
// email or phone is required (enforced again server-side and by a table CHECK).
export default function ContactSignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consentSms, setConsentSms] = useState(false);
  const [consentEmail, setConsentEmail] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim() && !phone.trim()) {
      setError("Please add an email or a phone number so we can reach you.");
      return;
    }

    setStatus("submitting");
    try {
      const res = await fetch("/api/contact-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          consent_sms: consentSms,
          consent_email: consentEmail,
        }),
      });

      if (res.ok) {
        setStatus("done");
        setName("");
        setEmail("");
        setPhone("");
        setConsentSms(false);
        setConsentEmail(false);
        return;
      }

      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Something went wrong. Please try again.");
      setStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  };

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-brand-primary/40 bg-brand-primary/10 p-8 text-center">
        <h3 className="text-xl font-bold">You&apos;re on the list 🎶</h3>
        <p className="mt-2 text-text-secondary">
          Thanks! We&apos;ll be in touch with updates and specials.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm font-semibold text-brand-primary hover:underline"
        >
          Add another
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-brand-border bg-white/5 p-8"
    >
      <h3 className="text-2xl font-bold">Stay in the loop</h3>
      <p className="mt-2 text-sm text-text-secondary">
        Free to join. Leave your email for update &amp; special announcements,
        and/or your phone number to get texts. At least one is required.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label htmlFor="cs-name" className="block text-sm font-medium mb-1">
            Name <span className="text-text-secondary">(optional)</span>
          </label>
          <input
            id="cs-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="cs-email" className="block text-sm font-medium mb-1">
              Email <span className="text-text-secondary">(optional)</span>
            </label>
            <input
              id="cs-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none"
            />
            <p className="mt-1 text-xs text-text-secondary">
              For update &amp; special announcements.
            </p>
          </div>
          <div>
            <label htmlFor="cs-phone" className="block text-sm font-medium mb-1">
              Phone <span className="text-text-secondary">(optional)</span>
            </label>
            <input
              id="cs-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              className="w-full px-3 py-2 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none"
            />
            <p className="mt-1 text-xs text-text-secondary">
              For text updates.
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={consentSms}
              onChange={(e) => setConsentSms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-brand-border accent-brand-primary"
            />
            <span className="text-text-secondary">
              Text me updates &amp; specials
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={consentEmail}
              onChange={(e) => setConsentEmail(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-brand-border accent-brand-primary"
            />
            <span className="text-text-secondary">
              Email me updates &amp; specials
            </span>
          </label>
        </div>

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="w-full px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === "submitting" ? "Saving…" : "Keep me posted"}
        </button>
      </div>
    </form>
  );
}
