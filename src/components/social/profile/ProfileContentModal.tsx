"use client";

import { useEffect, useState } from "react";
import {
  X,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Loader2,
  Send,
  Trash2,
} from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import type { TileContent } from "./ProfileContentTile";

// A lightweight viewer for a single profile item (reel or gallery photo) with
// like / comment / share(reshare) / save actions wired to the social APIs.
// Comments work for both Mirror reels (/api/social/videos/[id]/comments) and
// gallery photos (/api/social/photos/[id]/comments).

type Comment = {
  id: string;
  content: string;
  created_at: string;
  user_id: string | null;
  user: {
    display_name: string;
    username: string;
    avatar_url: string | null;
  } | null;
};

export default function ProfileContentModal({
  type,
  content,
  onClose,
}: {
  type: "video" | "photo";
  content: TileContent;
  onClose: () => void;
}) {
  const id = content.id;
  const { user } = useAuth();
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(content.likes_count ?? 0);
  const [saved, setSaved] = useState(false);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState<null | "like" | "save" | "share">(null);

  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const likeEndpoint =
    type === "video"
      ? `/api/social/videos/${id}/like`
      : `/api/social/photos/${id}/like`;
  const commentsEndpoint =
    type === "video"
      ? `/api/social/videos/${id}/comments`
      : `/api/social/photos/${id}/comments`;

  // Hydrate like + save state on open.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [likeRes, saveRes] = await Promise.all([
        authFetch(likeEndpoint).catch(() => null),
        authFetch(
          `/api/social/saves?target_type=${type}&target_id=${id}`,
        ).catch(() => null),
      ]);
      if (!alive) return;
      if (likeRes?.ok) {
        const j = await likeRes.json();
        setLiked(!!j.liked);
        setLikesCount(j.likesCount ?? content.likes_count ?? 0);
      }
      if (saveRes?.ok) {
        const j = await saveRes.json();
        setSaved(!!j.saved);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, type]);

  // Load comments (reels and photos both support them).
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await authFetch(commentsEndpoint).catch(() => null);
      if (!alive) return;
      if (res?.ok) {
        const j = await res.json();
        setComments(j.comments ?? []);
      } else {
        setComments([]);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, type]);

  const toggleLike = async () => {
    setBusy("like");
    // Optimistic.
    setLiked((v) => !v);
    setLikesCount((c) => c + (liked ? -1 : 1));
    try {
      const res = await authFetch(likeEndpoint, { method: "POST" });
      if (res.ok) {
        const j = await res.json();
        setLiked(!!j.liked);
        setLikesCount(j.likesCount ?? 0);
      }
    } finally {
      setBusy(null);
    }
  };

  const toggleSave = async () => {
    setBusy("save");
    setSaved((v) => !v);
    try {
      const res = await authFetch("/api/social/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: type, target_id: id }),
      });
      if (res.ok) {
        const j = await res.json();
        setSaved(!!j.saved);
      }
    } finally {
      setBusy(null);
    }
  };

  const toggleShare = async () => {
    setBusy("share");
    setShared((v) => !v);
    try {
      const res = await authFetch("/api/social/reshares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: type, target_id: id }),
      });
      if (res.ok) {
        const j = await res.json();
        setShared(!!j.shared);
      }
    } finally {
      setBusy(null);
    }
  };

  const postComment = async () => {
    const text = draft.trim();
    if (!text) return;
    setPosting(true);
    try {
      const res = await authFetch(commentsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        const j = await res.json();
        const newComment: Comment = j.comment ?? j;
        setComments((prev) => (prev ? [newComment, ...prev] : [newComment]));
        setDraft("");
      }
    } finally {
      setPosting(false);
    }
  };

  // Delete one of the caller's own comments. Currently wired for photos, which
  // expose a DELETE handler on their comments endpoint.
  const deleteComment = async (commentId: string) => {
    setComments((prev) => prev?.filter((c) => c.id !== commentId) ?? prev);
    try {
      await authFetch(
        `${commentsEndpoint}?comment_id=${encodeURIComponent(commentId)}`,
        { method: "DELETE" },
      );
    } catch {
      // On failure, refetch to restore the true list.
      const res = await authFetch(commentsEndpoint).catch(() => null);
      if (res?.ok) {
        const j = await res.json();
        setComments(j.comments ?? []);
      }
    }
  };

  const mediaSrc =
    type === "video"
      ? content.video_url || content.thumbnail_url || ""
      : content.image_url || "";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-melori-border bg-melori-elevated md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Media */}
        <div className="flex flex-1 items-center justify-center bg-black">
          {type === "video" && content.video_url ? (
            <video
              src={content.video_url}
              controls
              autoPlay
              className="max-h-[50vh] w-full object-contain md:max-h-[90vh]"
            />
          ) : mediaSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaSrc}
              alt={content.title ?? ""}
              className="max-h-[50vh] w-full object-contain md:max-h-[90vh]"
            />
          ) : (
            <div className="p-12 text-melori-muted">No preview</div>
          )}
        </div>

        {/* Side panel: actions + comments */}
        <div className="flex w-full flex-col md:w-80">
          <div className="flex items-center justify-between border-b border-melori-border p-3">
            <p className="truncate text-sm font-semibold">
              {content.title || (type === "video" ? "Reel" : "Photo")}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 hover:bg-white/5"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-4 border-b border-melori-border p-3">
            <button
              type="button"
              onClick={toggleLike}
              disabled={busy === "like"}
              className={`flex items-center gap-1.5 text-sm font-semibold transition ${
                liked ? "text-red-500" : "text-melori-muted hover:text-melori-text"
              }`}
            >
              <Heart className={`h-5 w-5 ${liked ? "fill-red-500" : ""}`} />
              {likesCount}
            </button>
            <span className="flex items-center gap-1.5 text-sm text-melori-muted">
              <MessageCircle className="h-5 w-5" />
              {comments?.length ?? content.comments_count ?? 0}
            </span>
            <button
              type="button"
              onClick={toggleShare}
              disabled={busy === "share"}
              className={`flex items-center gap-1.5 text-sm font-semibold transition ${
                shared
                  ? "text-melori-purple"
                  : "text-melori-muted hover:text-melori-text"
              }`}
              aria-label="Reshare"
            >
              <Share2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={toggleSave}
              disabled={busy === "save"}
              className={`ml-auto flex items-center gap-1.5 text-sm font-semibold transition ${
                saved
                  ? "text-melori-purple"
                  : "text-melori-muted hover:text-melori-text"
              }`}
              aria-label="Save"
            >
              <Bookmark className={`h-5 w-5 ${saved ? "fill-current" : ""}`} />
            </button>
          </div>

          {/* Comments (reels and photos) */}
          <>
              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {comments === null ? (
                  <div className="flex justify-center py-8 text-melori-muted">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : comments.length === 0 ? (
                  <p className="py-8 text-center text-sm text-melori-muted">
                    No comments yet. Be the first.
                  </p>
                ) : (
                  comments.map((c) => {
                    const isMine =
                      type === "photo" &&
                      !!user?.id &&
                      c.user_id === user.id;
                    return (
                    <div key={c.id} className="group flex gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.user?.avatar_url || "/favicon.png"}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded-full object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-melori-text">
                          {c.user?.display_name ?? "Member"}
                        </p>
                        <p className="break-words text-sm text-melori-muted">
                          {c.content}
                        </p>
                      </div>
                      {isMine && (
                        <button
                          type="button"
                          onClick={() => deleteComment(c.id)}
                          className="shrink-0 rounded-lg p-1 text-melori-muted opacity-0 transition hover:bg-white/5 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
                          aria-label="Delete comment"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    );
                  })
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-melori-border p-3">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void postComment();
                    }
                  }}
                  placeholder="Add a comment…"
                  maxLength={2000}
                  className="flex-1 rounded-full border border-melori-border bg-melori-void/60 px-4 py-2 text-sm focus:border-melori-purple focus:outline-none"
                />
                <button
                  type="button"
                  onClick={postComment}
                  disabled={posting || !draft.trim()}
                  className="rounded-full bg-melori-purple p-2 text-white disabled:opacity-50"
                  aria-label="Post comment"
                >
                  {posting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </>
        </div>
      </div>
    </div>
  );
}
