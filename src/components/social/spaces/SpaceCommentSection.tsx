"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  useCanParticipate,
  UpgradePrompt,
} from "@/components/social/UpgradePrompt";
import { authFetch } from "@/lib/authClient";
import { MessageSquare } from "lucide-react";

interface SpaceComment {
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

// Per-space comment thread rendered below the stage. Reads are public.
// Posting requires Superfan+ (enforced server-side; the client falls back
// to the upgrade prompt when the caller isn't eligible).
export default function SpaceCommentSection({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();
  const [comments, setComments] = useState<SpaceComment[]>([]);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/social/spaces/${spaceId}/comments`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (!cancelled) {
          setComments(Array.isArray(data.comments) ? data.comments : []);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Live updates while the room is open.
    const channel = supabase
      .channel(`space_comments:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "space_comments",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload) => {
          const c = payload.new as SpaceComment;
          setComments((prev) =>
            prev.some((x) => x.id === c.id) ? prev : [c, ...prev],
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [spaceId]);

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

    const res = await authFetch(`/api/social/spaces/${spaceId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });

    if (res.ok) {
      const { comment } = await res.json();
      setComments((prev) =>
        prev.some((x) => x.id === comment.id) ? prev : [comment, ...prev],
      );
      setBody("");
      setIsSubmitting(false);
      return;
    }

    if (res.status === 403) {
      router.push("/membership");
      return;
    }
    if (res.status === 401) {
      router.push("/social/auth");
      return;
    }

    const data = await res.json().catch(() => ({}));
    setError(data?.error ?? "Could not post your comment. Please try again.");
    setIsSubmitting(false);
  };

  return (
    <div className="mt-10 border-t border-melori-border pt-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-melori-purple/15 flex items-center justify-center">
          <MessageSquare className="w-4 h-4 text-melori-purple" />
        </div>
        <div>
          <h3 className="font-bold">Room comments</h3>
          <p className="text-xs text-melori-muted">
            Anyone can read. Posting is a Superfan feature.
          </p>
        </div>
      </div>

      {canParticipate ? (
        <form onSubmit={handleSubmit} className="mb-6">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Share a thought with the room…"
            className="w-full bg-melori-elevated border border-melori-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition resize-none"
          />
          {error && (
            <p className="mt-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || !body.trim()}
              className="btn-primary px-5 py-2 rounded-full font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Posting…" : "Post"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mb-6">
          <UpgradePrompt action="comment" />
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-melori-muted py-6">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-center text-sm text-melori-muted py-6">
          No comments yet. Kick off the conversation.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li
              key={c.id}
              className="rounded-2xl border border-melori-border bg-melori-elevated/50 p-4"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm">
                  {c.author_name || "Superfan"}
                </span>
                <span className="text-xs text-melori-muted">
                  {relativeTime(c.created_at)}
                </span>
              </div>
              <p className="text-sm text-melori-text whitespace-pre-wrap break-words">
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
