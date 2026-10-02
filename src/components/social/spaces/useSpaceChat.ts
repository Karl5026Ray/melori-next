"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";
import { authReturnPath } from "@/lib/authReturn";
import { useAuth } from "@/components/social/providers/AuthProvider";

export interface SpaceChatMessage {
  id: string;
  user_id: string | null;
  author_name?: string | null;
  author_display?: string | null;
  avatar_url?: string | null;
  username?: string | null;
  body: string;
  created_at: string;
}

export function spaceChatAuthor(c: SpaceChatMessage): string {
  return c.author_display || c.author_name || "Member";
}

export type SpaceChatResult = { ok: true } | { ok: false; error: string };

/**
 * MM Spaces room chat: initial history, realtime inserts and deletes, posting
 * and moderator delete.
 *
 * Spaces' own copy. Spaces and Cinema keep separate room code (Karl, 2 Oct
 * 2026), so a change to Cinema's chat can never change this one. Both read
 * the same `space_comments` table and API routes, which are shared plumbing.
 */
export function useSpaceChat(spaceId: string) {
  const router = useRouter();
  const { user } = useAuth();

  const [comments, setComments] = useState<SpaceChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Initial load (newest-first from the API → reverse to chronological).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/social/spaces/${spaceId}/comments`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled) {
          const rows: SpaceChatMessage[] = Array.isArray(data.comments)
            ? [...data.comments].reverse()
            : [];
          setComments(rows);
        }
      } catch {
        /* ignore — empty feed is fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Realtime rows already persist `author_name`; use it directly rather than
  // issuing a profile query per message. History is enriched server-side.
  useEffect(() => {
    const channel = supabase
      .channel(`space_chat:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "space_comments",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload) => {
          const row = payload.new as SpaceChatMessage;
          if (user && row.user_id === user.id) return; // already added optimistically
          setComments((prev) =>
            prev.some((x) => x.id === row.id) ? prev : [...prev, row],
          );
        },
      )
      // A moderator deleted a line. Realtime cannot apply a column filter to
      // DELETE events (the old row carries only its primary key), so this
      // listens unfiltered and drops the id only if this room is showing it.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "space_comments" },
        (payload) => {
          const id = (payload.old as { id?: string } | null)?.id;
          if (!id) return;
          setComments((prev) =>
            prev.some((x) => x.id === id) ? prev.filter((x) => x.id !== id) : prev,
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [spaceId, user]);

  // Kept in a ref so sendComment stays referentially stable for callers that
  // pass it straight into a memoised child.
  const sendingRef = useRef(false);

  const sendComment = useCallback(
    async (raw: string): Promise<SpaceChatResult> => {
      if (!user) {
        // Return to the room after signing in. AuthForm honours ?next= (and
        // threads it through the OAuth round-trip), so without this the user
        // loses the room the moment they try to say something in it.
        router.push(`/social/auth?next=${encodeURIComponent(authReturnPath())}`);
        return { ok: false, error: "Sign in to comment." };
      }
      const text = raw.trim();
      if (!text || sendingRef.current) return { ok: false, error: "" };
      sendingRef.current = true;
      setSending(true);
      setError("");
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        });
        if (res.ok) {
          const { comment } = await res.json();
          setComments((prev) =>
            prev.some((x) => x.id === comment.id) ? prev : [...prev, comment],
          );
          return { ok: true };
        }
        // The auth wall is a redirect, not an inline error.
        if (res.status === 401) {
          router.push(`/social/auth?next=${encodeURIComponent(authReturnPath())}`);
          return { ok: false, error: "" };
        }
        const data = await res.json().catch(() => ({}));
        const message = data?.error ?? "Could not post. Try again.";
        setError(message);
        return { ok: false, error: message };
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [user, spaceId, router],
  );

  // Host / moderator / author delete. Optimistic, restored if the server says
  // no, so a refused delete never leaves a line looking gone on one screen only.
  const deleteComment = useCallback(
    async (id: string): Promise<SpaceChatResult> => {
      let removed: SpaceChatMessage | undefined;
      let index = -1;
      setComments((prev) => {
        index = prev.findIndex((x) => x.id === id);
        removed = prev[index];
        return prev.filter((x) => x.id !== id);
      });
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/comments/${id}`, {
          method: "DELETE",
        });
        if (res.ok) return { ok: true };
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Could not delete that message.");
      } catch (err) {
        const restore = removed;
        if (restore) {
          setComments((prev) => {
            if (prev.some((x) => x.id === restore.id)) return prev;
            const next = [...prev];
            next.splice(Math.min(Math.max(index, 0), next.length), 0, restore);
            return next;
          });
        }
        const message = err instanceof Error ? err.message : "Could not delete that message.";
        setError(message);
        return { ok: false, error: message };
      }
    },
    [spaceId],
  );

  return { comments, setComments, sendComment, deleteComment, sending, error, setError };
}
