"use client";

import { useEffect, useRef, useState } from "react";
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
  // Populated from the space_comments_with_author view / profile join so every
  // comment renders a real author + avatar instead of a bare name.
  author_display?: string | null;
  avatar_url?: string | null;
  username?: string | null;
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

function displayName(c: SpaceComment): string {
  return c.author_display || c.author_name || "Superfan";
}

// Per-space comment thread rendered below the stage. Reads are public.
// Posting requires Superfan+ (enforced server-side; the client falls back
// to the upgrade prompt when the caller isn't eligible).
export default function SpaceCommentSection({
  spaceId,
  // "live" renders the thread as a bottom-anchored chat (oldest → newest,
  // newest at the bottom) inside its own scroll area, with the composer pinned
  // below the feed. Used by the MM Faces live room overlay so incoming comments
  // auto-scroll into view instead of being clipped/hidden behind the input.
  live = false,
}: {
  spaceId: string;
  live?: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();
  const [comments, setComments] = useState<SpaceComment[]>([]);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Live-chat auto-scroll. We only stick to the bottom when the viewer is
  // already near it, so reading back through history isn't yanked away by an
  // incoming comment.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // In live mode, comments arrive newest-first (prepended in state) but render
  // oldest-first so the newest sits at the bottom of the feed.
  const orderedComments = live ? [...comments].slice().reverse() : comments;

  // Scroll to the newest message on load and whenever a comment arrives, but
  // only if the viewer is pinned near the bottom (or it's the initial paint).
  useEffect(() => {
    if (!live) return;
    if (!nearBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [live, comments, loading]);

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

    // Live updates while the room is open. The realtime INSERT payload only
    // carries the raw space_comments row (no profile join), so we resolve the
    // author's avatar/name from profiles before inserting into state. This is
    // what keeps every incoming comment tied to a real person's profile pic.
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
        async (payload) => {
          const row = payload.new as SpaceComment;

          // Our own comment is already added optimistically by handleSubmit.
          if (user && row.user_id === user.id) return;

          let enriched: SpaceComment = row;
          if (row.user_id) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("display_name, full_name, username, avatar_url")
              .eq("id", row.user_id)
              .maybeSingle();
            if (profile) {
              enriched = {
                ...row,
                author_display:
                  profile.display_name ||
                  profile.full_name ||
                  profile.username ||
                  row.author_name,
                avatar_url: profile.avatar_url ?? null,
                username: profile.username ?? null,
              };
            }
          }

          setComments((prev) =>
            prev.some((x) => x.id === enriched.id) ? prev : [enriched, ...prev],
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [spaceId, user]);

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

  const renderComment = (c: SpaceComment) => {
    const name = displayName(c);
    const initial = name.charAt(0).toUpperCase();
    const profileHref = c.username ? `/social/u/${c.username}` : undefined;
    const Avatar = (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-melori-purple/30 text-xs font-semibold">
        {c.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.avatar_url}
            alt={name}
            className="h-full w-full object-cover"
          />
        ) : (
          initial
        )}
      </span>
    );
    return (
      <li
        key={c.id}
        className="rounded-2xl border border-melori-border bg-melori-elevated/50 p-4"
      >
        <div className="flex items-center gap-2 mb-1">
          {profileHref ? (
            <a href={profileHref} className="shrink-0">
              {Avatar}
            </a>
          ) : (
            Avatar
          )}
          {profileHref ? (
            <a
              href={profileHref}
              className="font-semibold text-sm hover:underline"
            >
              {name}
            </a>
          ) : (
            <span className="font-semibold text-sm">{name}</span>
          )}
          <span className="text-xs text-melori-muted">
            {relativeTime(c.created_at)}
          </span>
        </div>
        <p className="text-sm text-melori-text whitespace-pre-wrap break-words">
          {c.body}
        </p>
      </li>
    );
  };

  const composer = canParticipate ? (
    <form onSubmit={handleSubmit}>
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
    <UpgradePrompt action="comment" />
  );

  // Live room: bottom-anchored chat. The feed scrolls on its own and the
  // composer is pinned below it (never overlapping), so incoming comments stay
  // visible above the input and auto-scroll into view.
  if (live) {
    return (
      <div className="flex h-full flex-col gap-2">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto pr-1"
        >
          {loading ? (
            <p className="text-center text-sm text-melori-muted py-6">
              Loading…
            </p>
          ) : orderedComments.length === 0 ? (
            <p className="text-center text-sm text-melori-muted py-6">
              No comments yet. Kick off the conversation.
            </p>
          ) : (
            <ul className="space-y-3">{orderedComments.map(renderComment)}</ul>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="shrink-0">{composer}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-lg mb-1">Room comments</h3>
        <p className="text-sm text-melori-muted mb-4">
          Anyone can read. Posting is a Superfan feature.
        </p>

        {canParticipate ? composer : <div className="mb-6">{composer}</div>}
      </div>

      {loading ? (
        <p className="text-center text-sm text-melori-muted py-6">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-center text-sm text-melori-muted py-6">
          No comments yet. Kick off the conversation.
        </p>
      ) : (
        <ul className="space-y-3">{comments.map(renderComment)}</ul>
      )}
    </div>
  );
}
