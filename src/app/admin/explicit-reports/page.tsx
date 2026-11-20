"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ExplicitBadge from "@/components/ExplicitBadge";

// Listener "Report as explicit" flags, one row per track, most-flagged first.
// Artists label explicit tracks themselves on upload; this queue is the backstop
// for tracks that slipped through unlabeled. One click per track:
//   Mark explicit — adds the E badge and keeps it off the homepage radio
//   Remove        — takes the track down (reversible moderation removal)
//   Dismiss       — the reports were wrong; close them, track unchanged

type Item = {
  key: string;
  sourceType: "studio" | "legacy";
  id: string;
  title: string;
  artist: string | null;
  explicit: boolean;
  public: boolean;
  flags: number;
  lastFlaggedAt: string;
};

type Action = "mark_explicit" | "remove" | "dismiss";

export default function AdminExplicitReportsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/explicit-reports", { cache: "no-store" });
      if (res.status === 401) {
        setError("Not signed in as admin. Please log in at /admin.");
        return;
      }
      if (!res.ok) {
        setError("Failed to load explicit reports.");
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setThreshold(data.autoMarkThreshold ?? null);
    } catch {
      setError("Failed to load explicit reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(async (item: Item, action: Action) => {
    if (
      action === "remove" &&
      !confirm(`Take down "${item.title}"? Listeners will no longer see it.`)
    ) {
      return;
    }
    setBusy(item.key);
    try {
      const res = await fetch("/api/admin/explicit-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, action }),
      });
      if (!res.ok) {
        alert("Action failed. Try again.");
        return;
      }
      setItems((prev) => prev.filter((x) => x.key !== item.key));
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Explicit Reports</h1>
            <p className="text-sm text-text-secondary">
              Songs listeners reported as explicit but not labeled.
              {threshold
                ? ` Songs auto-label as explicit at ${threshold} reports.`
                : " Auto-labeling is off."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={() => void load()}
              className="rounded-lg border border-brand-border px-3 py-1.5 text-sm hover:bg-surface"
            >
              Refresh
            </button>
            <Link href="/admin/dashboard" className="text-sm text-text-secondary hover:underline">
              Back
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-text-secondary">Loading…</p>
        ) : items.length === 0 && !error ? (
          <p className="text-text-secondary">No open reports.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex flex-col gap-3 rounded-lg border border-brand-border bg-brand-surface p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{item.title}</span>
                    <ExplicitBadge explicit={item.explicit} />
                    {!item.public && (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-text-secondary">
                        not public
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    {item.artist ?? "Unknown artist"} ·{" "}
                    <span className="font-semibold text-text-primary">
                      {item.flags} {item.flags === 1 ? "report" : "reports"}
                    </span>{" "}
                    · last {new Date(item.lastFlaggedAt).toLocaleString()}
                    {item.sourceType === "studio" && item.public && (
                      <>
                        {" "}
                        ·{" "}
                        <Link href={`/music/${item.id}`} className="hover:underline">
                          open
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!item.explicit && (
                    <button
                      onClick={() => void act(item, "mark_explicit")}
                      disabled={busy === item.key}
                      className="rounded-lg bg-brand-primary/15 px-3 py-1.5 text-xs font-medium text-brand-primary hover:bg-brand-primary/25 disabled:opacity-50"
                    >
                      Mark explicit
                    </button>
                  )}
                  <button
                    onClick={() => void act(item, "remove")}
                    disabled={busy === item.key}
                    className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    Remove
                  </button>
                  <button
                    onClick={() => void act(item, "dismiss")}
                    disabled={busy === item.key}
                    className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-white/10 disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
