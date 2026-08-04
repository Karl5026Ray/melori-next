"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authClient";
import {
  TOTAL_BASIS_POINTS,
  formatBasisPoints,
  ownerBasisPoints,
  percentToBasisPoints,
  validateSplits,
} from "@/lib/revenue-splits";

// Collaborator revenue splits for one item. Entirely optional: an item with no
// rows pays the uploading artist 100%, which is what every sale did before this
// existed. The artist's own share is shown but never edited directly — it is
// the remainder, so the two can't disagree.

interface SplitRow {
  key: string;
  name: string;
  username: string;
  email: string;
  percent: string;
  linked: boolean;
}

interface ApiSplit {
  id: string;
  basis_points: number;
  payee_name: string;
  payee_email: string | null;
  payee_username: string | null;
  payee_profile_id: string | null;
}

let rowCounter = 0;
function newRow(): SplitRow {
  rowCounter += 1;
  return {
    key: `new-${rowCounter}`,
    name: "",
    username: "",
    email: "",
    percent: "",
    linked: false,
  };
}

export default function SplitsEditor({
  kind,
  itemId,
  itemTitle,
}: {
  kind: "studio_track" | "studio_album";
  itemId: string;
  itemTitle: string;
}) {
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/studio/splits?kind=${kind}&id=${encodeURIComponent(itemId)}`,
      );
      if (!res.ok) {
        setRows([]);
        return;
      }
      const data = await res.json();
      setRows(
        ((data.splits ?? []) as ApiSplit[]).map((s) => ({
          key: s.id,
          name: s.payee_name,
          username: s.payee_username ?? "",
          email: s.payee_email ?? "",
          percent: String(s.basis_points / 100),
          linked: Boolean(s.payee_profile_id),
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [kind, itemId]);

  useEffect(() => {
    load();
  }, [load]);

  const parsed = rows.map((r) => ({
    row: r,
    basisPoints: percentToBasisPoints(Number(r.percent)) ?? 0,
  }));
  const validation = validateSplits(
    parsed.map((p) => ({ basisPoints: p.basisPoints, label: p.row.name })),
  );
  const ownerBps = ownerBasisPoints(
    parsed.map((p) => ({ basisPoints: p.basisPoints })),
  );

  const update = (key: string, patch: Partial<SplitRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    setError(null);
    setSaved(false);

    for (const { row, basisPoints } of parsed) {
      if (!row.name.trim()) {
        setError("Every collaborator needs a name.");
        return;
      }
      if (basisPoints <= 0) {
        setError(`${row.name.trim()}: enter a percentage above 0.`);
        return;
      }
      if (!row.username.trim() && !row.email.trim()) {
        setError(
          `${row.name.trim()}: add their Melori username or email so they can be paid.`,
        );
        return;
      }
    }
    if (!validation.valid) {
      setError(validation.errors[0]);
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch("/api/studio/splits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          id: itemId,
          splits: parsed.map(({ row, basisPoints }) => ({
            basis_points: basisPoints,
            payee_name: row.name.trim(),
            payee_username: row.username.trim() || null,
            payee_email: row.email.trim() || null,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not save splits.");
        return;
      }
      setSaved(true);
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-xs text-[#888]">Loading splits…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-[#888]">
          Revenue splits
        </p>
        <p className="text-xs text-[#666]">
          You keep{" "}
          <span
            className={ownerBps < 0 ? "text-red-400" : "text-[#c9a96e]"}
          >
            {formatBasisPoints(Math.max(ownerBps, 0))}
          </span>{" "}
          of {itemTitle}
        </p>
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-[#666]">
          No collaborators — the full artist share goes to you.
        </p>
      )}

      {rows.map((row) => (
        <div
          key={row.key}
          className="grid gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 sm:grid-cols-[1.2fr_1.2fr_1.4fr_auto_auto]"
        >
          <input
            type="text"
            value={row.name}
            onChange={(e) => update(row.key, { name: e.target.value })}
            placeholder="Collaborator name"
            aria-label="Collaborator name"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#c9a96e]/40"
          />
          <input
            type="text"
            value={row.username}
            onChange={(e) => update(row.key, { username: e.target.value })}
            placeholder="@melori-username"
            aria-label="Melori username"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#c9a96e]/40"
          />
          <input
            type="email"
            value={row.email}
            onChange={(e) => update(row.key, { email: e.target.value })}
            placeholder="email (if not on Melori)"
            aria-label="Collaborator email"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#c9a96e]/40"
          />
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={row.percent}
              onChange={(e) => update(row.key, { percent: e.target.value })}
              placeholder="0"
              aria-label="Percentage share"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-3 pr-7 text-sm outline-none focus:border-[#c9a96e]/40 sm:w-24"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#888]">
              %
            </span>
          </div>
          <button
            type="button"
            onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#888] hover:border-red-500/40 hover:text-red-400"
            aria-label={`Remove ${row.name || "collaborator"}`}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, newRow()])}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:border-[#c9a96e]/40"
        >
          + Add collaborator
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !validation.valid}
          className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-black hover:bg-[#f0d99c] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save splits"}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
      </div>

      {!validation.valid && (
        <p className="text-xs text-red-400">{validation.errors[0]}</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-xs text-[#666]">
        Shares are taken out of the sale after Stripe&apos;s processing fee, and
        must total no more than {formatBasisPoints(TOTAL_BASIS_POINTS)}. A
        collaborator who hasn&apos;t set up payouts yet still gets their share
        recorded — it&apos;s held until they connect an account.
      </p>
    </div>
  );
}
