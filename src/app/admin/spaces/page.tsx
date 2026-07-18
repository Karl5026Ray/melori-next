"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/authClient";
import { Radio, RefreshCw, Power, ArrowLeft } from "lucide-react";

type HostInfo = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string | null;
  verified: boolean | null;
};

type AdminSpace = {
  id: string;
  title: string | null;
  topic: string | null;
  type: string | null;
  room_format: string | null;
  status: string;
  host_id: string | null;
  created_at: string | null;
  last_activity_at: string | null;
  scheduled_at: string | null;
  ended_at: string | null;
  hearts_count: number | null;
  host: HostInfo | HostInfo[] | null;
  occupancy: number | null;
};

function hostOf(s: AdminSpace): HostInfo | null {
  if (!s.host) return null;
  return Array.isArray(s.host) ? (s.host[0] ?? null) : s.host;
}

// Compact "3h 12m ago" style age from an ISO timestamp.
function ago(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
}

// A room is flagged "dormant" when it's live but has no real occupancy, OR its
// last activity is well in the past — the exact case the empty-room reaper can
// miss when a ghost presence keeps it from ever reading as truly empty.
function isDormant(s: AdminSpace): boolean {
  if (s.status !== "live") return false;
  const la = s.last_activity_at ?? s.created_at;
  const staleMs = la ? Date.now() - new Date(la).getTime() : 0;
  const stale = staleMs > 30 * 60 * 1000; // 30 min
  const empty = s.occupancy !== null && s.occupancy <= 0;
  return empty || stale;
}

export default function AdminSpacesPage() {
  const [spaces, setSpaces] = useState<AdminSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"live" | "scheduled" | "all">(
    "live",
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(
        `/api/admin/spaces?status=${statusFilter}`,
        { cache: "no-store" },
      );
      if (res.status === 401 || res.status === 403) {
        setError("Not signed in as admin. Please log in at /admin.");
        setSpaces([]);
        return;
      }
      if (!res.ok) {
        setError("Failed to load spaces.");
        return;
      }
      const data = await res.json();
      setSpaces(data.spaces ?? []);
    } catch {
      setError("Failed to load spaces.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const shutDown = useCallback(
    async (s: AdminSpace) => {
      const label = s.title || s.topic || s.id.slice(0, 8);
      if (
        !window.confirm(
          `Shut down "${label}"?\n\nThis ends the room for everyone and tears down the live audio/video session. This cannot be undone.`,
        )
      ) {
        return;
      }
      setBusyId(s.id);
      setNotice(null);
      setError(null);
      try {
        const res = await authFetch(`/api/admin/spaces/${s.id}/end`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || "Failed to shut down the room.");
          return;
        }
        setNotice(
          data.alreadyEnded
            ? `"${label}" was already ended — cleaned up any lingering session.`
            : `"${label}" has been shut down.`,
        );
        // Refresh so the ended room drops off the live list.
        await load();
      } catch {
        setError("Failed to shut down the room.");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return (
    <div className="min-h-screen bg-melori-bg text-melori-text p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center gap-1 text-sm text-melori-muted hover:text-melori-text"
          >
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </div>

        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <Radio className="w-6 h-6 text-melori-primary" /> Spaces
            </h1>
            <p className="text-melori-muted text-sm mt-1">
              End dormant or stuck rooms. Shutting down a room ends it for
              everyone and tears down the live session immediately.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "live" | "scheduled" | "all")
              }
              className="bg-melori-card border border-melori-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="live">Live</option>
              <option value="scheduled">Scheduled</option>
              <option value="all">All</option>
            </select>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1 bg-melori-card border border-melori-border rounded-lg px-3 py-2 text-sm hover:bg-melori-border/40 disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {notice}
          </div>
        )}

        {loading && spaces.length === 0 ? (
          <p className="text-melori-muted text-sm">Loading spaces…</p>
        ) : spaces.length === 0 ? (
          <p className="text-melori-muted text-sm">
            No {statusFilter === "all" ? "" : statusFilter} spaces right now.
          </p>
        ) : (
          <div className="space-y-3">
            {spaces.map((s) => {
              const host = hostOf(s);
              const dormant = isDormant(s);
              return (
                <div
                  key={s.id}
                  className={`rounded-xl border p-4 flex items-start justify-between gap-4 ${
                    dormant
                      ? "border-amber-500/50 bg-amber-500/5"
                      : "border-melori-border bg-melori-card"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">
                        {s.title || s.topic || "Untitled room"}
                      </span>
                      <span
                        className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                          s.status === "live"
                            ? "border-emerald-500/50 text-emerald-300"
                            : "border-melori-border text-melori-muted"
                        }`}
                      >
                        {s.status}
                      </span>
                      {dormant && (
                        <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-amber-500/60 text-amber-300">
                          Dormant
                        </span>
                      )}
                      {s.room_format && (
                        <span className="text-[11px] text-melori-muted">
                          {s.room_format}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-melori-muted mt-1 truncate">
                      Host: {host?.display_name || s.host_id?.slice(0, 8) || "—"}
                    </div>
                    <div className="text-xs text-melori-muted mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        Occupancy:{" "}
                        {s.occupancy === null ? "—" : s.occupancy}
                      </span>
                      <span>Created {ago(s.created_at)}</span>
                      <span>Active {ago(s.last_activity_at)}</span>
                      <span className="font-mono opacity-70">
                        {s.id.slice(0, 8)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => shutDown(s)}
                    disabled={busyId === s.id || s.status !== "live"}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-red-600 hover:bg-red-500 text-white px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    title={
                      s.status !== "live"
                        ? "Only live rooms can be shut down"
                        : "End this room now"
                    }
                  >
                    <Power className="w-4 h-4" />
                    {busyId === s.id ? "Shutting down…" : "Shut down"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
