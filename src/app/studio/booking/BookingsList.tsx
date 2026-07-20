"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import type { BookingItem, BookingStatus } from "./types";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadgeClass(status: BookingStatus): string {
  switch (status) {
    case "confirmed":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "cancelled":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "completed":
      return "bg-brand-muted text-text-secondary border-brand-border";
    default:
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  }
}

export default function BookingsList() {
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/studio/bookings", { method: "GET" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load bookings.");
      setBookings(body.bookings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bookings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: BookingItem[] = [];
    const pa: BookingItem[] = [];
    for (const b of bookings) {
      const isFuture = new Date(b.startsAt).getTime() >= now;
      if (isFuture && b.status !== "cancelled" && b.status !== "completed") {
        up.push(b);
      } else {
        pa.push(b);
      }
    }
    up.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    pa.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
    return { upcoming: up, past: pa };
  }, [bookings]);

  const setStatus = async (id: string, status: BookingStatus) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await authFetch(`/api/studio/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update booking.");
      setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update booking.");
    } finally {
      setBusyId(null);
    }
  };

  const list = tab === "upcoming" ? upcoming : past;

  return (
    <div className="rounded-xl border border-brand-border bg-brand-surface p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-brand-primary shrink-0">
          <CalendarClock className="h-5 w-5" />
        </span>
        <div>
          <p className="font-semibold text-sm">Bookings</p>
          <p className="text-xs text-text-secondary">Confirm, cancel, or complete a session.</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("upcoming")}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
            tab === "upcoming"
              ? "bg-brand-primary text-white"
              : "bg-brand-muted text-text-secondary"
          }`}
        >
          Upcoming ({upcoming.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("past")}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
            tab === "past" ? "bg-brand-primary text-white" : "bg-brand-muted text-text-secondary"
          }`}
        >
          Past / cancelled ({past.length})
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-text-secondary">Loading…</p>
      ) : list.length === 0 ? (
        <p className="mt-4 text-sm text-text-secondary">No bookings here yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {list.map((b) => (
            <div
              key={b.id}
              className="rounded-lg border border-brand-border bg-black/20 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {b.serviceName ?? "Session"} — {b.clientName}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {new Date(b.startsAt).toLocaleString()} · {b.clientEmail}
                    {b.clientPhone ? ` · ${b.clientPhone}` : ""}
                  </p>
                  {b.notes && (
                    <p className="mt-1 text-xs text-text-secondary italic">"{b.notes}"</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusBadgeClass(b.status)}`}
                    >
                      {b.status}
                    </span>
                    {b.depositCents > 0 && (
                      <span className="text-[10px] text-text-secondary">
                        Deposit {formatPrice(b.depositCents)} · {b.depositPaid ? "paid" : "unpaid"}
                      </span>
                    )}
                    {b.hasGoogleEvent && (
                      <span className="text-[10px] text-text-secondary">On calendar</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {b.status === "pending" && (
                  <button
                    type="button"
                    disabled={busyId === b.id}
                    onClick={() => setStatus(b.id, "confirmed")}
                    className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 disabled:opacity-50"
                  >
                    <CalendarCheck className="h-3.5 w-3.5" /> Confirm
                  </button>
                )}
                {(b.status === "pending" || b.status === "confirmed") && (
                  <>
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => setStatus(b.id, "completed")}
                      className="flex items-center gap-1.5 rounded-full bg-brand-muted px-3 py-1.5 text-xs font-semibold text-text-primary disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Mark completed
                    </button>
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => {
                        if (window.confirm("Cancel this booking? The client will be emailed.")) {
                          void setStatus(b.id, "cancelled");
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-400 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
