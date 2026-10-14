"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, RefreshCw, Send, Trash2 } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import {
  SIGNUP_STATUSES,
  countByStatus,
  pendingEmailsForPlayConsole,
  type SignupStatus,
} from "@/lib/androidBeta";

type Signup = {
  id: string;
  email: string;
  name: string | null;
  country: string | null;
  user_id: string | null;
  status: SignupStatus;
  created_at: string;
  added_at: string | null;
  invited_at: string | null;
  source: string | null;
};

const STATUS_STYLE: Record<SignupStatus, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  added: "bg-sky-500/15 text-sky-300",
  invited: "bg-emerald-500/15 text-emerald-300",
  removed: "bg-white/5 text-[#777]",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

// Same gate as /admin/mirror: the proxy checks the admin_session cookie for the
// page, and /api/admin/android-testers requires profiles.role === 'admin' via
// the forwarded Supabase token (authFetch).
export default function AdminAndroidTestersPage() {
  const [rows, setRows] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/admin/android-testers", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setError("Not signed in as admin. Please log in at /admin.");
        setRows([]);
        return;
      }
      if (!res.ok) {
        setError("Failed to load testers.");
        return;
      }
      const data = await res.json();
      setRows(data.items ?? []);
    } catch {
      setError("Failed to load testers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => countByStatus(rows), [rows]);
  const pendingCsv = useMemo(() => pendingEmailsForPlayConsole(rows), [rows]);
  // Invite = everyone pending (just pasted into Play Console) plus anyone left
  // 'added' by a failed send last time.
  const toInvite = useMemo(
    () => rows.filter((r) => r.status === "pending" || r.status === "added"),
    [rows],
  );
  const visible = showRemoved ? rows : rows.filter((r) => r.status !== "removed");

  const copyPending = async () => {
    setNotice(null);
    setError(null);
    if (!pendingCsv) return;
    try {
      await navigator.clipboard.writeText(pendingCsv);
      setNotice(
        `Copied ${counts.pending} email${counts.pending === 1 ? "" : "s"}. Paste them into Play Console → Testing → Closed testing → Testers → Melori Android Testers → edit, then save.`,
      );
    } catch {
      // Clipboard can be blocked; fall back to a prompt the admin can copy from.
      window.prompt("Copy these emails:", pendingCsv);
    }
  };

  const invite = async () => {
    if (toInvite.length === 0) return;
    if (
      !window.confirm(
        `Have you saved these ${toInvite.length} email(s) in the Play Console list "Melori Android Testers"?\n\nThey will be marked added and each will get the invite email with both links.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await authFetch("/api/admin/android-testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", ids: toInvite.map((r) => r.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Invite failed.");
      } else {
        const failed: string[] = data.failed ?? [];
        setNotice(
          `Sent ${data.sent} invite${data.sent === 1 ? "" : "s"}.` +
            (failed.length ? ` Failed (still 'added', click again to retry): ${failed.join(", ")}` : ""),
        );
      }
    } catch {
      setError("Invite failed.");
    } finally {
      setBusy(false);
      void load();
    }
  };

  const remove = async (r: Signup) => {
    if (!window.confirm(`Mark ${r.email} as removed?\n\nAlso remove them from the Play Console list.`)) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await authFetch("/api/admin/android-testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", id: r.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data?.error || "Remove failed.");
      else setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "removed" } : x)));
    } catch {
      setError("Remove failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="bg-[#0d0d0d] border-b border-white/[0.06] px-4 md:px-8 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/dashboard" className="text-[#888] hover:text-white" aria-label="Back to dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-xl font-bold">Android testers</h1>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-sm text-[#ccc] hover:bg-white/10"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SIGNUP_STATUSES.map((s) => (
            <div key={s} className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4">
              <p className="text-xs uppercase tracking-wider text-[#888]">{s}</p>
              <p className="text-2xl font-bold text-[#c9a96e]">{loading ? "…" : counts[s]}</p>
            </div>
          ))}
        </div>

        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4 md:p-6 space-y-3">
          <p className="text-sm text-[#aaa]">
            1. Copy pending emails → paste into Play Console → Testing → Closed testing →
            Testers → <span className="text-white">Melori Android Testers</span> → edit → save.
            <br />
            2. Then send invites. Each tester gets the opt-in link and the install link.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => void copyPending()}
              disabled={!pendingCsv || busy}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 text-[#ddd] rounded-lg text-sm font-medium hover:bg-white/10 disabled:opacity-40"
            >
              <Copy className="h-4 w-4" /> Copy pending emails ({counts.pending})
            </button>
            <button
              onClick={() => void invite()}
              disabled={toInvite.length === 0 || busy}
              className="flex items-center gap-2 px-4 py-2 bg-[#c9a96e] text-[#0a0a0a] rounded-lg text-sm font-semibold hover:bg-[#d8bd88] disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
              {busy ? "Working…" : `Mark pending as added & send invites (${toInvite.length})`}
            </button>
          </div>
          {notice && <p className="text-sm text-emerald-300">{notice}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Signups</h2>
          <label className="flex items-center gap-2 text-xs text-[#888]">
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
            Show removed
          </label>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wider text-[#888]">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Country</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Signed up</th>
                <th className="px-3 py-2">Invited</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[#666]">
                    No signups yet.
                  </td>
                </tr>
              )}
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.05]">
                  <td className="px-3 py-2 font-mono text-xs break-all">
                    {r.email}
                    {r.user_id && <span className="ml-1 text-[#666]" title="Linked Melori account">●</span>}
                  </td>
                  <td className="px-3 py-2">{r.name ?? "—"}</td>
                  <td className="px-3 py-2">{r.country ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-[#aaa] whitespace-nowrap">{fmt(r.created_at)}</td>
                  <td className="px-3 py-2 text-xs text-[#aaa] whitespace-nowrap">{fmt(r.invited_at)}</td>
                  <td className="px-3 py-2 text-xs text-[#aaa]">{r.source ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {r.status !== "removed" && (
                      <button
                        onClick={() => void remove(r)}
                        disabled={busy}
                        className="p-1.5 rounded-lg text-[#888] hover:bg-red-500/10 hover:text-red-300"
                        aria-label={`Remove ${r.email}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
