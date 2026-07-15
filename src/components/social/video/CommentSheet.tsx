"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";

interface CommentUser {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  verified?: boolean;
  role?: string | null;
}

interface VideoComment {
  id: string;
  video_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user?: CommentUser | null;
}

interface CommentSheetProps {
  videoId: string;
  open: boolean;
  onClose: () => void;
  // Bubble the authoritative count up so the card badge stays in sync.
  onCountChange?: (count: number) => void;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function CommentSheet({
  videoId,
  open,
  onClose,
  onCountChange,
}: CommentSheetProps) {
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSignedIn(!!data.session));
  }, []);

  // Load comments each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/social/videos/${videoId}/comments`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setComments(Array.isArray(d.comments) ? d.comments : []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load comments.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, videoId]);

  async function submit() {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await authFetch(`/api/social/videos/${videoId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Couldn't post your comment.");
        return;
      }
      setComments((prev) => [data.comment as VideoComment, ...prev]);
      setText("");
      if (typeof data.commentsCount === "number") {
        onCountChange?.(data.commentsCount);
      }
      inputRef.current?.focus();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPosting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      {/* Backdrop */}
      <button
        aria-label="Close comments"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      {/* Sheet */}
      <div className="relative flex max-h-[70%] flex-col rounded-t-2xl border-t border-white/10 bg-melori-elevated text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-semibold">
            {comments.length > 0
              ? `${comments.length} comment${comments.length === 1 ? "" : "s"}`
              : "Comments"}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-white/70 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex justify-center py-8 text-white/60">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : comments.length === 0 ? (
            <p className="py-8 text-center text-sm text-white/60">
              No comments yet. Be the first.
            </p>
          ) : (
            <ul className="space-y-4">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <img
                    src={c.user?.avatar_url || "/favicon.png"}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full border border-white/20 object-cover"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold">
                        {c.user?.display_name ||
                          c.user?.username ||
                          "Listener"}
                      </span>
                      <span className="text-white/40">
                        {timeAgo(c.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 break-words text-sm text-white/90">
                      {c.content}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="px-4 pb-1 text-xs text-red-400">{error}</p>
        )}

        {/* Composer */}
        <div className="border-t border-white/10 p-3">
          {signedIn ? (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                maxLength={2000}
                placeholder="Add a comment…"
                className="flex-1 rounded-full bg-white/10 px-4 py-2 text-sm text-white placeholder-white/40 outline-none focus:bg-white/15"
              />
              <button
                onClick={submit}
                disabled={!text.trim() || posting}
                aria-label="Post comment"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-primary text-white disabled:opacity-40"
              >
                {posting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          ) : (
            <a
              href="/social/auth"
              className="block rounded-full bg-white/10 px-4 py-2 text-center text-sm text-white/80 hover:bg-white/15"
            >
              Sign in to comment
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
