"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, CalendarX2, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/authClient";

// Minimal "Connect Google Calendar" control — Phase 3. Mounted on
// /studio/services for now (the only Studio surface this phase touches);
// Phase 4 will move/repeat it on the future /studio/booking page once
// availability + booking ships. Reads ?calendar=connected|error off the URL
// (set by the OAuth callback redirect) to surface a one-time result banner.
export default function CalendarConnectCard() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<"connected" | "error" | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/studio/calendar/status", { method: "GET" });
      if (res.status === 503) {
        setConfigured(false);
        setConnected(false);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load calendar status.");
      setConnected(Boolean(body.connected));
      setCalendarId(body.calendarId ?? null);
      setConfigured(body.configured !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load calendar status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Surface the one-time result banner from the OAuth callback redirect,
  // then strip the query param so a refresh doesn't re-show it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const calendarParam = params.get("calendar");
    if (calendarParam === "connected" || calendarParam === "error") {
      setBanner(calendarParam);
      params.delete("calendar");
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      window.history.replaceState({}, "", next);
    }
  }, []);

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/api/studio/calendar/connect", { method: "GET" });
      if (res.status === 503) {
        setConfigured(false);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error ?? "Could not start connect flow.");
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start connect flow.");
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/api/studio/calendar/disconnect", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not disconnect calendar.");
      setConnected(false);
      setCalendarId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect calendar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-border bg-brand-surface p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-brand-primary shrink-0">
          {connected ? (
            <CalendarCheck2 className="h-5 w-5" />
          ) : (
            <CalendarX2 className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-sm">Google Calendar</p>
          <p className="text-xs text-text-secondary">
            {loading
              ? "Checking connection…"
              : !configured
                ? "Not configured yet — ask Karl to set up Google OAuth."
                : connected
                  ? `Connected${calendarId && calendarId !== "primary" ? ` (${calendarId})` : ""} — booking availability will sync two-way.`
                  : "Connect your calendar so busy times block booking and confirmed shoots get added automatically."}
          </p>
        </div>
      </div>

      {banner === "connected" && (
        <p className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-400">
          Google Calendar connected successfully.
        </p>
      )}
      {banner === "error" && (
        <p className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-400">
          Couldn&apos;t connect Google Calendar. Please try again.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="mt-4">
        {!loading && configured && (
          connected ? (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-full border border-brand-border hover:bg-brand-muted transition-colors py-2.5 px-5 text-sm font-semibold disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-2.5 px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Connect Google Calendar
            </button>
          )
        )}
      </div>
    </div>
  );
}
