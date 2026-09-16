"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";
import type { WhisperMessage } from "@/components/social/cinema/CinemaWhisperSidebar";

export interface WhisperTarget {
  userId: string;
  displayName: string;
}

type ServerMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

/**
 * A private side conversation between a Cinema room's host (or a moderator)
 * and someone in the room.
 *
 * The transport is the ordinary direct-message system, not a room-scoped
 * channel. Opening a whisper opens or continues the pair's 1:1 conversation,
 * which means it is DURABLE: it persists past the room, appears in both
 * inboxes, and inherits blocking, moderation and the email digest. The
 * sidebar's copy says so, because a person deserves to know that a "whisper"
 * is a real message before they send one.
 *
 * Authorization lives entirely on the server. `/whisper` decides whether the
 * caller may open the thread at all; sending then goes through the existing
 * messages route, which already enforces membership, blocks, length and
 * moderation. Nothing here is a permission check.
 */
export function useCinemaWhisper(spaceId: string | null, selfId: string | null) {
  const [target, setTarget] = useState<WhisperTarget | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly WhisperMessage[]>([]);
  const [opening, setOpening] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetRef = useRef<WhisperTarget | null>(null);
  targetRef.current = target;
  const selfIdRef = useRef<string | null>(selfId);
  selfIdRef.current = selfId;

  const toWhisper = useCallback((row: ServerMessage): WhisperMessage => {
    const mine = row.sender_id === selfIdRef.current;
    return {
      id: row.id,
      fromUserId: row.sender_id,
      fromDisplayName: mine ? "You" : targetRef.current?.displayName ?? "Them",
      body: row.content,
      sentAt: row.created_at,
    };
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    setConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  const open = useCallback(
    async (next: WhisperTarget) => {
      if (!spaceId) return;
      setTarget(next);
      setMessages([]);
      setConversationId(null);
      setError(null);
      setOpening(true);
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/whisper`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_user_id: next.userId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          conversation_id?: string;
          messages?: ServerMessage[];
          error?: string;
        };
        if (!res.ok || !data.conversation_id) {
          throw new Error(data.error ?? "Could not open a whisper.");
        }
        setConversationId(data.conversation_id);
        setMessages((data.messages ?? []).map(toWhisper));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open a whisper.");
        // Leave the sidebar open showing the error rather than closing it, so
        // the reason is visible instead of the panel just refusing to appear.
      } finally {
        setOpening(false);
      }
    },
    [spaceId, toWhisper],
  );

  // Live delivery, the same way the Messages thread page does it.
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`cinema_whisper:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as ServerMessage | null;
          if (!row) return;
          setMessages((prev) =>
            // The sender already appended their own message from the POST
            // response; realtime echoes it straight back.
            prev.some((m) => m.id === row.id) ? prev : [...prev, toWhisper(row)],
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, toWhisper]);

  const send = useCallback(
    async (rawBody: string) => {
      const content = rawBody.trim();
      if (!content || !conversationId) return;
      setSending(true);
      try {
        const res = await authFetch("/api/social/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: conversationId, content }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          message?: ServerMessage;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Could not send that whisper.");
        if (data.message) {
          const sent = toWhisper(data.message);
          setMessages((prev) =>
            prev.some((m) => m.id === sent.id) ? prev : [...prev, sent],
          );
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send that whisper.");
      } finally {
        setSending(false);
      }
    },
    [conversationId, toWhisper],
  );

  return { target, open, close, messages, send, opening, sending, error };
}
