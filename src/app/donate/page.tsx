"use client";

import { useState } from "react";

const PRESETS = [5, 10, 25, 50, 100];

export default function DonatePage() {
  const [amount, setAmount] = useState<number>(25);
  const [custom, setCustom] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function getAmount(): number {
    if (custom) {
      const n = parseFloat(custom);
      if (!isNaN(n) && n > 0) return n;
    }
    return amount;
  }

  async function handleDonate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = getAmount();
    if (!value || value < 1) {
      setError("Please enter an amount of at least $1.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/donate/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: value,
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          message: message.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setError(data?.error || "Could not start checkout. Please try again.");
        setSubmitting(false);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-brand-background text-text-primary">
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Support Melori Music
          </h1>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            Artists keep 100% of every sale — Melori takes no cut. Your donation
            funds the platform itself: the servers, the tools, and the new
            features that keep independent music thriving. Thank you.
          </p>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-6 pb-20">
        <form
          onSubmit={handleDonate}
          className="rounded-2xl border border-brand-border bg-white/5 p-8 space-y-6"
        >
          <div>
            <label className="block text-sm font-semibold mb-3">
              Choose an amount
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {PRESETS.map((p) => {
                const active = !custom && amount === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setAmount(p);
                      setCustom("");
                    }}
                    className={`px-4 py-3 rounded-lg border font-semibold transition-colors ${
                      active
                        ? "bg-brand-primary border-brand-primary text-white"
                        : "border-brand-border text-text-primary hover:border-brand-primary"
                    }`}
                  >
                    ${p}
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <label
                htmlFor="custom"
                className="block text-sm text-text-secondary mb-1"
              >
                Or enter a custom amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">
                  $
                </span>
                <input
                  id="custom"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="decimal"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-3 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Name <span className="text-text-secondary">(optional)</span>
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email <span className="text-text-secondary">(optional)</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="message" className="block text-sm font-medium mb-1">
              Message <span className="text-text-secondary">(optional)</span>
            </label>
            <textarea
              id="message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none resize-none"
              placeholder="Anything you'd like us to know"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting
              ? "Redirecting…"
              : `Donate $${getAmount().toFixed(2)}`}
          </button>

          <p className="text-xs text-text-secondary text-center">
            Secure payment by Stripe. Your card details never touch our servers.
          </p>
        </form>
      </section>
    </div>
  );
}
