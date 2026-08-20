"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Ban, Flag, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";

interface MemberActionsProps {
  memberId: string;
  memberName?: string | null;
  initiallyBlocked?: boolean;
  variant?: "row" | "menu";
}

const REPORT_REASONS = [
  { value: "harassment", label: "Harassment or hate" },
  { value: "nudity", label: "Nudity / sexual content" },
  { value: "violence", label: "Violence or threats" },
  { value: "spam", label: "Spam or scam" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Something else" },
];

// Actions shown for another member: start a DM (Superfan+), block/unblock, or
// report. "Report & Block" is a single affordance that files a report AND blocks
// in one step (the common safety flow); a plain "Block" is offered separately.
// Hidden entirely when the member is the signed-in user or nobody is signed in.
export function MemberActions({
  memberId,
  memberName,
  initiallyBlocked = false,
  variant = "row",
}: MemberActionsProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [blocked, setBlocked] = useState<boolean>(initiallyBlocked);
  const [busy, setBusy] = useState<"dm" | "block" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Report dialog state.
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0].value);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (!user || !memberId || user.id === memberId) return null;

  const who = memberName ?? "this member";

  const startDm = async () => {
    setBusy("dm");
    setError(null);
    try {
      const res = await authFetch("/api/social/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: memberId }),
      });
      const body = await res.json().catch(() => ({}) as any);
      if (!res.ok) {
        if (res.status === 403) {
          setError(body?.error ?? "Messaging is unavailable between you two.");
        } else if (res.status === 401) {
          setError("Please sign in to send a message.");
        } else {
          setError(body?.error ?? "Could not start conversation.");
        }
        setBusy(null);
        return;
      }
      const conversationId = body?.conversation_id;
      if (!conversationId) {
        setError("Could not start conversation.");
        setBusy(null);
        return;
      }
      router.push(`/social/messages/${conversationId}`);
    } catch (err: any) {
      setError(err?.message ?? "Could not start conversation.");
      setBusy(null);
    }
  };

  const doBlock = async (unblock: boolean): Promise<boolean> => {
    const res = await authFetch("/api/social/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocked_id: memberId, unblock }),
    });
    const body = await res.json().catch(() => ({}) as any);
    if (!res.ok) {
      setError(body?.error ?? "Could not update block status.");
      return false;
    }
    setBlocked(Boolean(body?.blocked));
    return true;
  };

  const toggleBlock = async () => {
    const next = !blocked;
    if (next && !window.confirm(`Block ${who}? They won't be able to message you or see your profile.`)) {
      return;
    }
    setBusy("block");
    setError(null);
    await doBlock(!next);
    setBusy(null);
  };

  // Report & Block: file the report, then block. The report is submitted first
  // so the record survives even if the block toggle fails; the block still
  // fires regardless of a duplicate-report response.
  const submitReportAndBlock = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await authFetch("/api/social/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: "profile",
          reported_user: memberId,
          reason,
          details: details.trim() || null,
        }),
      });
      const ok = await doBlock(false);
      if (ok) {
        setDone(true);
        setTimeout(() => {
          setReportOpen(false);
          setDone(false);
          setDetails("");
        }, 1400);
      }
    } catch (err: any) {
      setError(err?.message ?? "Could not submit report.");
    } finally {
      setSubmitting(false);
    }
  };

  const btnBase =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";

  return (
    <div className={variant === "menu" ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2"}>
      {!blocked && (
        <button
          type="button"
          onClick={startDm}
          disabled={busy !== null}
          className={`${btnBase} bg-melori-accent/15 text-melori-accent hover:bg-melori-accent/25`}
          aria-label={`Message ${who}`}
        >
          {busy === "dm" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
          <span>Message</span>
        </button>
      )}

      <button
        type="button"
        onClick={toggleBlock}
        disabled={busy !== null}
        className={`${btnBase} ${
          blocked
            ? "bg-melori-accent/15 text-melori-accent hover:bg-melori-accent/25"
            : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
        }`}
        aria-label={blocked ? `Unblock ${who}` : `Block ${who}`}
      >
        {busy === "block" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Ban className="h-4 w-4" />
        )}
        <span>{blocked ? "Unblock" : "Block"}</span>
      </button>

      {!blocked && (
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          disabled={busy !== null}
          className={`${btnBase} bg-red-500/10 text-red-400 hover:bg-red-500/20`}
          aria-label={`Report and block ${who}`}
        >
          <Flag className="h-4 w-4" />
          <span>Report &amp; Block</span>
        </button>
      )}

      {error && <span className="text-xs text-red-400">{error}</span>}

      {reportOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
          onClick={() => !submitting && setReportOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-melori-border bg-melori-elevated p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {done ? (
              <p className="py-6 text-center text-sm text-melori-text">
                Reported &amp; blocked. Our team will review. 🙏
              </p>
            ) : (
              <>
                <h3 className="mb-1 text-lg font-bold text-melori-text">
                  Report &amp; block {who}
                </h3>
                <p className="mb-3 text-xs text-melori-muted">
                  We&apos;ll file a report to our team and block this member so you
                  no longer see each other.
                </p>
                <label className="mb-1 block text-xs text-melori-muted">Reason</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-melori-border bg-melori-void px-3 py-2 text-sm text-melori-text"
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <label className="mb-1 block text-xs text-melori-muted">
                  Details (optional)
                </label>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder="Add anything that helps us review…"
                  className="mb-4 w-full resize-none rounded-lg border border-melori-border bg-melori-void px-3 py-2 text-sm text-melori-text"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    disabled={submitting}
                    className="rounded-lg border border-melori-border px-3 py-1.5 text-sm text-melori-muted hover:bg-white/5 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitReportAndBlock()}
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {submitting ? "Submitting…" : "Report & Block"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
