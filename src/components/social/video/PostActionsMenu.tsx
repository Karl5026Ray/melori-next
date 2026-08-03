"use client";

import { useState } from "react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { MoreVertical, Trash2, Flag, Loader2 } from "lucide-react";

// Per-post overflow menu on a Mirror/video card:
//   • Delete  — visible to the post OWNER and to ADMIN (profiles.role==='admin').
//               Calls DELETE /api/social/videos/[id] (owner+admin enforced
//               server-side too).
//   • Report  — visible to everyone else (the "request first if there's a
//               violation" flow). Calls POST /api/social/report with
//               content_type:'video'.
//
// The admin flow is: a user reports a violation → admin reviews → admin deletes.
// The owner can always delete their own post directly.

type Props = {
  videoId: string;
  ownerId: string;
  onDeleted?: (videoId: string) => void;
};

const REPORT_REASONS = ["nudity", "harassment", "spam", "hate", "other"] as const;

export default function PostActionsMenu({ videoId, ownerId, onDeleted }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "confirmDelete" | "report">("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>("spam");
  const [reported, setReported] = useState(false);

  const isOwner = !!user && user.id === ownerId;
  const isAdmin = !!user && user.role === "admin";
  const canDelete = isOwner || isAdmin;

  const close = () => {
    setOpen(false);
    setMode("menu");
    setError(null);
    setReported(false);
  };

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/social/videos/${videoId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not delete this post");
      onDeleted?.(videoId);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doReport = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/api/social/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: "video",
          content_id: videoId,
          reported_user: ownerId,
          reason,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not submit report");
      }
      setReported(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Signed-out users get no menu at all.
  if (!user) return null;

  return (
    <div className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More options"
        className="flex flex-col items-center gap-1 text-white"
      >
        <MoreVertical className="w-7 h-7" />
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <button
            aria-hidden
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <div className="absolute bottom-10 right-0 z-50 w-60 rounded-xl bg-neutral-900 p-2 text-white shadow-2xl">
            {mode === "menu" && (
              <div className="flex flex-col">
                {canDelete && (
                  <button
                    onClick={() => setMode("confirmDelete")}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-800"
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                    Delete post{isAdmin && !isOwner ? " (admin)" : ""}
                  </button>
                )}
                {!isOwner && (
                  <button
                    onClick={() => setMode("report")}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-800"
                  >
                    <Flag className="h-4 w-4 text-amber-400" />
                    Report a violation
                  </button>
                )}
              </div>
            )}

            {mode === "confirmDelete" && (
              <div className="p-1">
                <p className="px-2 py-1 text-sm">Delete this post permanently?</p>
                {error && <p className="px-2 text-xs text-red-400">{error}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={close}
                    disabled={busy}
                    className="flex-1 rounded-lg bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={doDelete}
                    disabled={busy}
                    className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold hover:bg-red-500 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Delete"}
                  </button>
                </div>
              </div>
            )}

            {mode === "report" && (
              <div className="p-1">
                {reported ? (
                  <div className="p-2 text-sm">
                    <p className="font-medium text-green-400">Report submitted.</p>
                    <p className="mt-1 text-xs text-white/70">
                      Thanks — our team will review this post.
                    </p>
                    <button
                      onClick={close}
                      className="mt-3 w-full rounded-lg bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="px-2 py-1 text-sm">Why are you reporting this?</p>
                    <select
                      value={reason}
                      onChange={(e) => setReason(e.target.value as typeof reason)}
                      className="mx-2 mt-1 w-[calc(100%-1rem)] rounded-lg bg-neutral-800 px-2 py-1.5 text-sm capitalize outline-none"
                    >
                      {REPORT_REASONS.map((r) => (
                        <option key={r} value={r} className="capitalize">
                          {r}
                        </option>
                      ))}
                    </select>
                    {error && <p className="px-2 pt-1 text-xs text-red-400">{error}</p>}
                    <div className="mt-2 flex gap-2 px-1">
                      <button
                        onClick={close}
                        disabled={busy}
                        className="flex-1 rounded-lg bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={doReport}
                        disabled={busy}
                        className="flex-1 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-amber-400 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Submit"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
