"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { authFetch } from "@/lib/authClient";

type Props = {
  contentType: "message" | "comment" | "gallery" | "profile" | "track" | "other";
  contentId?: string | null;
  reportedUser?: string | null;
  /** Render as a small icon button (default) or a full text button. */
  variant?: "icon" | "text";
  className?: string;
};

const REASONS = [
  { value: "nudity", label: "Nudity / sexual content" },
  { value: "harassment", label: "Harassment or hate" },
  { value: "violence", label: "Violence or threats" },
  { value: "spam", label: "Spam or scam" },
  { value: "other", label: "Something else" },
];

// A lightweight report control usable anywhere user content is shown. Opens a
// small dialog to pick a reason + optional note, then POSTs to /api/social/report.
export default function ReportButton({
  contentType,
  contentId = null,
  reportedUser = null,
  variant = "icon",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("nudity");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await authFetch("/api/social/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          reported_user: reportedUser,
          reason,
          details: details.trim() || null,
        }),
      });
      if (res.ok) {
        setDone(true);
        setTimeout(() => {
          setOpen(false);
          setDone(false);
          setDetails("");
        }, 1400);
      } else {
        alert("Couldn't submit the report. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Report"
          title="Report"
          className={`text-text-secondary hover:text-red-400 ${className}`}
        >
          <Flag className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex items-center gap-2 text-sm text-text-secondary hover:text-red-400 ${className}`}
        >
          <Flag className="h-4 w-4" /> Report
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
          onClick={() => !submitting && setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-brand-border bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {done ? (
              <p className="py-6 text-center text-sm text-text-primary">
                Thanks — our team will review this. 🙏
              </p>
            ) : (
              <>
                <h3 className="mb-3 text-lg font-bold text-text-primary">Report content</h3>
                <label className="mb-1 block text-xs text-text-secondary">Reason</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-brand-border bg-background px-3 py-2 text-sm text-text-primary"
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <label className="mb-1 block text-xs text-text-secondary">
                  Details (optional)
                </label>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder="Add anything that helps us review…"
                  className="mb-4 w-full resize-none rounded-lg border border-brand-border bg-background px-3 py-2 text-sm text-text-primary"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="rounded-lg border border-brand-border px-3 py-1.5 text-sm text-text-secondary hover:bg-muted disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {submitting ? "Submitting…" : "Submit report"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
