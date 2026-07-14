"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type QueueItem = {
  id: string;
  content_type: string;
  content_id: string | null;
  author_id: string | null;
  decision?: string;
  reason: string | null;
  media_url: string | null;
  excerpt: string | null;
  created_at: string;
};

type ReportItem = {
  id: string;
  content_type: string;
  content_id: string | null;
  reported_user: string | null;
  reporter_id: string | null;
  reason: string | null;
  details: string | null;
  created_at: string;
};

function safeHttp(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export default function AdminModerationPage() {
  const [moderation, setModeration] = useState<QueueItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"auto" | "reports">("auto");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/moderation/queue", { cache: "no-store" });
      if (res.status === 401) {
        setError("Not signed in as admin. Please log in at /admin.");
        return;
      }
      if (!res.ok) {
        setError("Failed to load the moderation queue.");
        return;
      }
      const data = await res.json();
      setModeration(data.moderation ?? []);
      setReports(data.reports ?? []);
    } catch {
      setError("Failed to load the moderation queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (
      kind: "moderation" | "report",
      item: QueueItem | ReportItem,
      action: "approve" | "remove" | "dismiss",
    ) => {
      setBusy(item.id);
      try {
        const res = await fetch("/api/admin/moderation/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            id: item.id,
            action,
            content_type: item.content_type,
            content_id: item.content_id,
          }),
        });
        if (!res.ok) {
          alert("Action failed. Try again.");
          return;
        }
        // Optimistically drop the item from view.
        if (kind === "moderation") setModeration((m) => m.filter((x) => x.id !== item.id));
        else setReports((r) => r.filter((x) => x.id !== item.id));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Content Moderation</h1>
            <p className="text-sm text-text-secondary">
              Quarantined &amp; flagged content, plus user reports.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void load()}
              className="rounded-lg border border-brand-border px-3 py-1.5 text-sm hover:bg-surface"
            >
              Refresh
            </button>
            <Link
              href="/admin/dashboard"
              className="rounded-lg bg-brand-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-primary-dark"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-2 border-b border-brand-border">
          <button
            onClick={() => setTab("auto")}
            className={`px-4 py-2 text-sm font-semibold ${
              tab === "auto"
                ? "border-b-2 border-brand-primary text-brand-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Auto-flagged ({moderation.length})
          </button>
          <button
            onClick={() => setTab("reports")}
            className={`px-4 py-2 text-sm font-semibold ${
              tab === "reports"
                ? "border-b-2 border-brand-primary text-brand-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            User reports ({reports.length})
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {loading && <p className="text-text-secondary">Loading…</p>}

        {!loading && tab === "auto" && (
          <div className="space-y-3">
            {moderation.length === 0 && (
              <p className="text-text-secondary">Nothing in the auto-flagged queue. 🎉</p>
            )}
            {moderation.map((item) => {
              const img = safeHttp(item.media_url);
              const isQuarantine = item.decision === "quarantined";
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-brand-border bg-surface p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        isQuarantine
                          ? "bg-red-500/20 text-red-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {isQuarantine ? "Quarantined" : "Flagged"}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-text-secondary">
                      {item.content_type}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>
                  {item.reason && (
                    <p className="mb-2 text-sm text-text-secondary">
                      Reason: <span className="text-text-primary">{item.reason}</span>
                    </p>
                  )}
                  {item.excerpt && (
                    <p className="mb-2 rounded-lg bg-background p-2 text-sm">
                      “{item.excerpt}”
                    </p>
                  )}
                  {img && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt=""
                      className="mb-2 max-h-48 rounded-lg object-contain"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={busy === item.id}
                      onClick={() => void act("moderation", item, "approve")}
                      className="rounded-lg bg-green-600/80 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
                    >
                      Approve (make public)
                    </button>
                    <button
                      disabled={busy === item.id}
                      onClick={() => void act("moderation", item, "remove")}
                      className="rounded-lg bg-red-600/80 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      Remove
                    </button>
                    <button
                      disabled={busy === item.id}
                      onClick={() => void act("moderation", item, "dismiss")}
                      className="rounded-lg border border-brand-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && tab === "reports" && (
          <div className="space-y-3">
            {reports.length === 0 && (
              <p className="text-text-secondary">No open reports. 🎉</p>
            )}
            {reports.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-brand-border bg-surface p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-text-secondary">
                    {item.content_type}
                  </span>
                  {item.reason && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                      {item.reason}
                    </span>
                  )}
                  <span className="text-xs text-text-secondary">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </div>
                {item.details && (
                  <p className="mb-2 rounded-lg bg-background p-2 text-sm">{item.details}</p>
                )}
                <p className="mb-2 text-xs text-text-secondary">
                  Reported item: {item.content_id ?? "—"}
                  {item.reported_user ? ` · user ${item.reported_user}` : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={busy === item.id}
                    onClick={() => void act("report", item, "remove")}
                    className="rounded-lg bg-red-600/80 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    Remove content
                  </button>
                  <button
                    disabled={busy === item.id}
                    onClick={() => void act("report", item, "dismiss")}
                    className="rounded-lg border border-brand-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
