"use client";

import { useState } from "react";
import { Shield, Flag, UserX, HeartOff, X } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { REPORT_CATEGORIES } from "./types";

// Block · Report · Unmatch — always ≤ 1 tap away from a match/conversation.
// Renders a small action row; report opens a bottom-sheet category picker.
export function SafetyActions({
  targetId,
  matchId,
  onUnmatched,
}: {
  targetId: string;
  matchId?: string | null;
  onUnmatched?: () => void;
}) {
  const [sheet, setSheet] = useState<null | "report">(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function unmatch() {
    if (!matchId || busy) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/social/connect/unmatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_id: matchId }),
      });
      if (res.ok) {
        setNotice("Unmatched. Your message history is retained for safety.");
        onUnmatched?.();
      }
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/social/connect/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: targetId }),
      });
      if (res.ok) {
        setNotice("Blocked. They can no longer contact you anywhere on Melori.");
        onUnmatched?.();
      }
    } finally {
      setBusy(false);
    }
  }

  async function report(category: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/social/connect/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reported: targetId, category, match_id: matchId ?? undefined }),
      });
      if (res.ok) {
        setSheet(null);
        setNotice("Report submitted. Our team will review it.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {matchId && (
          <button
            type="button"
            onClick={unmatch}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-melori-border bg-melori-elevated px-3 py-1.5 text-xs font-medium text-melori-muted transition hover:text-melori-warning disabled:opacity-50"
          >
            <HeartOff className="h-3.5 w-3.5" /> Unmatch
          </button>
        )}
        <button
          type="button"
          onClick={() => setSheet("report")}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-melori-border bg-melori-elevated px-3 py-1.5 text-xs font-medium text-melori-muted transition hover:text-melori-warning disabled:opacity-50"
        >
          <Flag className="h-3.5 w-3.5" /> Report
        </button>
        <button
          type="button"
          onClick={block}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-melori-border bg-melori-elevated px-3 py-1.5 text-xs font-medium text-melori-muted transition hover:text-melori-danger disabled:opacity-50"
        >
          <UserX className="h-3.5 w-3.5" /> Block
        </button>
      </div>

      {notice && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-melori-success">
          <Shield className="h-3.5 w-3.5" /> {notice}
        </p>
      )}

      {sheet === "report" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
          onClick={() => setSheet(null)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl border border-melori-border bg-melori-surface p-5 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Report this member</h3>
              <button
                type="button"
                onClick={() => setSheet(null)}
                aria-label="Close"
                className="text-melori-muted hover:text-melori-text"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2">
              {REPORT_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => report(c.value)}
                  disabled={busy}
                  className="w-full rounded-xl border border-melori-border bg-melori-elevated px-4 py-3 text-left text-sm transition hover:border-melori-accent disabled:opacity-50"
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-melori-muted">
              Underage and non-consensual intimate image (NCII) reports are escalated
              immediately.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
