"use client";

// Blocked members management. Because a block makes the two profiles mutually
// invisible (the blocked member's profile 404s for the blocker), this screen is
// the reliable place to review and undo blocks — you can't rely on navigating
// back to a now-hidden profile to unblock.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/authClient";

type BlockedProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string | null;
};

type BlockedRow = {
  id: string;
  created_at: string;
  profile: BlockedProfile | null;
};

export default function BlockedMembersPage() {
  const [rows, setRows] = useState<BlockedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/social/block");
      if (res.status === 401) {
        setError("Please sign in to manage blocked members.");
        setRows([]);
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Failed to load");
      setRows(j.blocked ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unblock = async (memberId: string) => {
    setBusyId(memberId);
    try {
      const res = await authFetch("/api/social/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked_id: memberId, unblock: true }),
      });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== memberId));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/social/profile" className="text-sm text-melori-muted hover:text-melori-text">
          ‹ Back to profile
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-melori-text">Blocked members</h1>
        <p className="mt-1 text-sm text-melori-muted">
          Blocked members can&apos;t message you, wave at you, or see your profile — and
          you won&apos;t see theirs. Unblock anyone below to restore visibility.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-melori-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : error ? (
        <p className="rounded-2xl border border-melori-border bg-melori-elevated px-5 py-4 text-sm text-red-400">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-melori-border bg-melori-elevated px-5 py-10 text-center text-sm text-melori-muted">
          You haven&apos;t blocked anyone.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-2xl border border-melori-border bg-melori-elevated px-4 py-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.profile?.avatar_url || "/favicon.png"}
                alt=""
                className="h-11 w-11 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-melori-text">
                  {r.profile?.display_name || r.profile?.username || "Former member"}
                </div>
                {r.profile?.username && (
                  <div className="truncate text-xs text-melori-muted">
                    @{r.profile.username}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void unblock(r.id)}
                disabled={busyId === r.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-melori-accent/15 px-3 py-1.5 text-sm font-medium text-melori-accent transition hover:bg-melori-accent/25 disabled:opacity-50"
              >
                {busyId === r.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4" />
                )}
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
