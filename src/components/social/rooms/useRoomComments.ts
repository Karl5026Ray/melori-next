"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";
import { authReturnPath } from "@/lib/authReturn";
import { useAuth } from "@/components/social/providers/AuthProvider";

export interface ChatComment {
  id: string;
  user_id: string | null;
  author_name?: string | null;
  author_display?: string | null;
  avatar_url?: string | null;
  username?: string | null;
  body: string;
  created_at: string;
}

export function authorName(c: ChatComment): string {
  return c.author_display || c.author_name || "Superfan";
}

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * The room comment feed — initial load, realtime INSERTs, and posting.
 *
 * Extracted from RoomChat so the audio room's floating comment overlay and
 * Cinema's panel chat read the SAME stream instead of each opening their own
 * Supabase channel and API fetch. Both mount `room_chat:${spaceId}`, so
 * duplicating this would mean two subscriptions racing on one channel name.
 *
 * Reaction state deliberately stays in RoomChat: it is per-message chrome that
 * only the panel renders, and the overlay has no affordance for it.
 *
 * `enabled` exists so exactly one caller owns the channel per room. The audio
 * room drives the overlay from the page and never mounts RoomChat; Cinema does
 * the reverse. Passing false skips the fetch and the subscription — it does not
 * merely hide the UI — so the two paths can coexist without both binding
 * `room_chat:${spaceId}`.
 */
export function useRoomComments(spaceId: string, enabled = true) {
  const router = useRouter();
  const { user } = useAuth();

  const [comments, setComments] = useState<ChatComment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Initial load (newest-first from the API → reverse to chronological).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/social/spaces/${spaceId}/comments`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled) {
          const rows: ChatComment[] = Array.isArray(data.comments)
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
  }, [spaceId, enabled]);

  // Realtime: append INSERTs, resolving author profile for others' messages.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`room_chat:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "space_comments",
          filter: `space_id=eq.${spaceId}`,
        },
        async (payload) => {
          const row = payload.new as ChatComment;
          if (user && row.user_id === user.id) return; // already added optimistically
          let enriched: ChatComment = row;
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
            prev.some((x) => x.id === enriched.id) ? prev : [...prev, enriched],
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [spaceId, user, enabled]);

  // Kept in a ref so sendComment stays referentially stable for callers that
  // pass it straight into a memoised child.
  const sendingRef = useRef(false);

  const sendComment = useCallback(
    async (raw: string): Promise<SendResult> => {
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
        // Membership and auth walls are redirects, not inline errors.
        if (res.status === 403) {
          router.push("/membership");
          return { ok: false, error: "" };
        }
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

  return { comments, setComments, sendComment, sending, error, setError };
}
