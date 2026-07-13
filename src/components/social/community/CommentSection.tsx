"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  useCanParticipate,
  UpgradePrompt,
} from "@/components/social/UpgradePrompt";
import { authFetch } from "@/lib/authClient";
import { WaveButton } from "@/components/social/WaveButton";
import { MemberActions } from "@/components/social/MemberActions";
import { MessageSquare } from "lucide-react";

export interface CommunityComment {
  id: string;
  user_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function CommentSection({
  initialComments,
}: {
  initialComments: CommunityComment[];
}) {
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();
  const [comments, setComments] = useState<CommunityComment[]>(initialComments);

  // MM Social: pin the logged-in user's own entries to the TOP of the list so
  // their own profile/posts always appear first. Stable order otherwise.
  const orderedComments = useMemo(() => {
    if (!user?.id) return comments;
    const mine = comments.filter((c) => c.user_id === user.id);
    const others = comments.filter((c) => c.user_id !== user.id);
    return [...mine, ...others];
  }, [comments, user?.id]);

  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      router.push("/social/auth");
      return;
    }
    const text = body.trim();
    if (!text) return;

    setIsSubmitting(true);
    setError("");

    // Server independently enforces Superfan+ on this endpoint (403 otherwise).
    const res = await authFetch("/api/community/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });

    if (res.ok) {
      const { comment } = await res.json();
      setComments((prev) => [comment, ...prev]);
      setBody("");
      setIsSubmitting(false);
      return;
    }

    if (res.status === 403 || res.status === 401) {
      router.push("/membership");
      return;
    }

    const data = await res.json().catch(() => ({}));
    setError(data?.error ?? "Could not post your comment. Please try again.");
    setIsSubmitting(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-28 md:pb-8 animate-fade-in">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-melori-purple/15 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-melori-purple" />
          </div>
          <h2 className="text-2xl font-bold">Community</h2>
        </div>
        <p className="text-sm text-melori-muted mb-8">
          {canParticipate
            ? "Share updates, questions, and shout-outs with the Melori community."
            : "Anyone can read the conversation. Posting is a Superfan feature."}
        </p>

        {/* Composer / gate */}
        {canParticipate ? (
          <form onSubmit={handleSubmit} className="mb-10">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Share something with the community…"
              className="w-full bg-melori-elevated border border-melori-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition resize-none"
            />
            {error && (
              <p className="mt-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting || !body.trim()}
                className="btn-primary px-6 py-2.5 rounded-full font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Posting…" : "Post comment"}
              </button>
            </div>
          </form>
        ) : (
          <div className="mb-10">
            <UpgradePrompt action="comment" />
          </div>
        )}

        {/* Comment list */}
        {comments.length === 0 ? (
          <p className="text-center text-sm text-melori-muted py-8">
            No comments yet. Be the first to say something.
          </p>
        ) : (
          <ul className="space-y-4">
            {orderedComments.map((c) => {
              const isMine = !!user?.id && c.user_id === user.id;
              return (
              <li
                key={c.id}
                className={`rounded-2xl border p-4 ${
                  isMine
                    ? "border-melori-purple/40 bg-melori-purple/5"
                    : "border-melori-border bg-melori-elevated/50"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm">
                    {c.author_name || "Superfan"}
                  </span>
                  {isMine && (
                    <span className="rounded-full bg-melori-purple/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-melori-purple">
                      You
                    </span>
                  )}
                  <span className="text-xs text-melori-muted">
                    {relativeTime(c.created_at)}
                  </span>
                  {c.user_id && (
                <MemberActions memberId={c.user_id} memberName={c.author_name} />
                )}
                </div>
                <p className="text-sm text-melori-text whitespace-pre-wrap break-words">
                  {c.body}
                </p>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
