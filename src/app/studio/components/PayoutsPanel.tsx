"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authClient";

interface StatusResponse {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  needsOnboarding: boolean;
  error?: string;
  connectDisabled?: boolean;
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

  const active = status?.connected && status?.payoutsEnabled;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Get paid</h2>
        <p className="text-[#888] text-sm">
          Set up Stripe payouts to receive money from your music sales. You keep
          90% of every sale; Melori keeps 10%.
        </p>
      </div>

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
          {status?.connected && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
              <p className="text-sm text-amber-300">
                Your payout setup isn&apos;t finished yet. Continue onboarding to
                start receiving payouts.
              </p>
            </div>
          )}
          <button
            onClick={startOnboarding}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-[#f0d99c] disabled:opacity-50"
          >
            {busy
              ? "Starting…"
              : status?.connected
                ? "Continue payout setup"
                : "Set up payouts with Stripe"}
          </button>
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
