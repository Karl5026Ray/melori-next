"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface NotificationRow {
  id: string;
  type: string;
  data: { title?: string; body?: string; link?: string } | null;
  read: boolean;
  created_at: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const t = session?.access_token ?? null;
    setToken(t);
    if (!t) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { notifications: NotificationRow[] };
        setItems(data.notifications ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    if (!token) return;
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id }),
    });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  async function markAll() {
    if (!token) return;
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ all: true }),
    });
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  function onRowClick(n: NotificationRow) {
    if (!n.read) void markRead(n.id);
    const link = n.data?.link;
    if (link) router.push(link);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        {items.some((n) => !n.read) && (
          <button
            type="button"
            onClick={markAll}
            className="rounded-md border border-brand-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-brand-primary"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading && <p className="text-text-secondary">Loading…</p>}
      {!loading && !token && (
        <p className="text-text-secondary">Please sign in to view notifications.</p>
      )}
      {!loading && token && items.length === 0 && (
        <p className="text-text-secondary">You have no notifications yet.</p>
      )}

      <ul className="divide-y divide-brand-border rounded-lg border border-brand-border bg-brand-surface">
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onRowClick(n)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-muted"
            >
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  n.read ? "bg-transparent" : "bg-brand-primary"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-text-primary">
                  {n.data?.title ?? n.type}
                </span>
                {n.data?.body && (
                  <span className="block text-sm text-text-secondary">
                    {n.data.body}
                  </span>
                )}
                <span className="mt-0.5 block text-xs text-text-secondary/70">
                  {relativeTime(n.created_at)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
