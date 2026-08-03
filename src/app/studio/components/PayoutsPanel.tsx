"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authClient";

type PayoutState =
  | "not_started"
  | "incomplete"
  | "pending"
  | "enabled"
  | "restricted";

interface StatusResponse {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  needsOnboarding: boolean;
  state?: PayoutState;
  requirementsDue?: string[];
  pendingVerification?: string[];
  disabledReason?: string | null;
  error?: string;
  connectDisabled?: boolean;
}

// Stripe's requirement keys are machine-readable ("individual.id_number").
// Show the artist something they can act on instead.
function humanizeRequirement(key: string): string {
  const label = key
    .replace(/^(individual|company|business_profile|external_account)\./, "")
    .replace(/_/g, " ")
    .replace(/\./g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function PayoutsPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/artist/connect/status", { method: "GET" });
      const body = (await res.json().catch(() => ({}))) as StatusResponse;
      if (!res.ok) {
        setError(body?.error ?? "Could not load payout status.");
        setStatus(body?.connectDisabled ? body : null);
        return;
      }
      setStatus(body);
    } catch {
      setError("Could not load payout status. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount, and re-check when returning from the Stripe account link
  // (/studio?connect=return|refresh).
  useEffect(() => {
    loadStatus();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const connect = params.get("connect");
      if (connect === "return" || connect === "refresh") {
        params.delete("connect");
        const qs = params.toString();
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}${qs ? `?${qs}` : ""}`,
        );
        loadStatus();
      }
    }
  }, [loadStatus]);

  const startOnboarding = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/artist/connect/onboard", {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setError(body?.error ?? "Could not start payout setup. Please try again.");
        setBusy(false);
        return;
      }
      window.location.href = body.url as string;
    } catch {
      setError("Could not start payout setup. Please try again.");
      setBusy(false);
    }
  }, []);

  const openDashboard = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/artist/connect/dashboard", {
        method: "GET",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setError(body?.error ?? "Could not open your Stripe dashboard.");
        setBusy(false);
        return;
      }
      window.open(body.url as string, "_blank", "noopener,noreferrer");
      setBusy(false);
    } catch {
      setError("Could not open your Stripe dashboard.");
      setBusy(false);
    }
  }, []);

  const state: PayoutState =
    status?.state ??
    (status?.connected
      ? status.payoutsEnabled
        ? "enabled"
        : "incomplete"
      : "not_started");
  const active = state === "enabled";
  const requirements = status?.requirementsDue ?? [];

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Get paid</h2>
        <p className="text-[#888] text-sm">
          Set up Stripe payouts to receive money from your music sales. You keep
          100% of every sale — Melori takes no cut. Only Stripe&apos;s payment
          processing fee is deducted.
        </p>
      </div>

      {/* The consequence of NOT finishing setup, stated plainly. Sales still
          go through — the money just lands on Melori's account until the
          artist's own account can receive it. */}
      {!loading && !status?.connectDisabled && !active && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-amber-300">
            Your payouts aren&apos;t active yet
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            Your music still sells normally — but until this is finished, sales
            are collected into the Melori platform account instead of paid
            straight to you. Karl reconciles anything earned in the meantime
            once your account is live.
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-[#888] text-sm">Checking payout status…</p>
      ) : status?.connectDisabled ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="text-sm text-[#f0d99c]">
            {status.error ??
              "Stripe Connect is not enabled on the platform yet. Payouts will be available once it's activated."}
          </p>
        </div>
      ) : active ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <p className="text-sm font-medium text-emerald-300">
              Payouts active
            </p>
            <p className="text-xs text-[#9fb8a8] mt-1">
              Your account is set up and ready to receive payouts.
            </p>
          </div>
          <button
            onClick={openDashboard}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-[#f0d99c] disabled:opacity-50"
          >
            {busy ? "Opening…" : "Open Stripe dashboard"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {state === "pending" && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
              <p className="text-sm font-medium text-blue-300">
                Pending verification
              </p>
              <p className="mt-1 text-xs text-blue-200/80">
                Stripe has everything it asked for and is reviewing your
                account. This usually takes a day or two — nothing more is
                needed from you.
              </p>
              {(status?.pendingVerification?.length ?? 0) > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-blue-200/70">
                  {status?.pendingVerification?.map((r) => (
                    <li key={r}>{humanizeRequirement(r)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {state === "restricted" && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm font-medium text-red-300">
                Payouts restricted
              </p>
              <p className="mt-1 text-xs text-red-200/80">
                Stripe has paused payouts on your account until it gets more
                information from you.
              </p>
              {requirements.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-200/70">
                  {requirements.map((r) => (
                    <li key={r}>{humanizeRequirement(r)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {state === "incomplete" && status?.connected && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
              <p className="text-sm text-amber-300">
                Your payout setup isn&apos;t finished yet. Continue onboarding to
                start receiving payouts.
              </p>
              {requirements.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-200/70">
                  {requirements.map((r) => (
                    <li key={r}>{humanizeRequirement(r)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
  <p className="text-sm font-medium text-[#f0d99c]">
    Before you start, have these ready
  </p>
  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#9fb8a8]">
    <li>A valid email address to sign in to Stripe.</li>
    <li>
      A government-issued photo ID (driver&apos;s license or passport)
      to verify your identity.
    </li>
    <li>Your date of birth and home address.</li>
    <li>
      Your bank account and routing numbers (or a debit card) so
      payouts land in your account.
    </li>
    <li>
      For US taxes: your SSN (or EIN if you pay out to a business).
    </li>
  </ul>
  <p className="mt-2 text-xs text-[#7a8a80]">
    You enter this on Stripe&apos;s secure page &mdash; Melori never sees
    or stores your ID or bank details. Setup takes about 5 minutes.
  </p>
</div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={startOnboarding}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-[#f0d99c] disabled:opacity-50"
            >
              {busy
                ? "Starting…"
                : state === "restricted"
                  ? "Fix payout setup"
                  : status?.connected
                    ? "Continue payout setup"
                    : "Set up payouts with Stripe"}
            </button>
            {status?.connected && (
              <button
                onClick={openDashboard}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium transition-colors hover:border-[#c9a96e]/40 disabled:opacity-50"
              >
                Open Stripe dashboard
              </button>
            )}
          </div>
        </div>
      )}

      {error && !status?.connectDisabled && (
        <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
