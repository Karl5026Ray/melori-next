"use client";

// RoomChat — the shared in-room message feed used by MM Spaces, MM Faces and
// MM Connect (via RoomPanel). It fixes the long-standing display problems:
//   • Newest messages are always reachable and the feed AUTO-SCROLLS to the
//     bottom when the viewer is already at/near the bottom.
//   • When the viewer has scrolled up, new messages DON'T yank them down;
//     instead a "N new messages" pill appears — tapping it jumps to the bottom
//     and re-enables auto-scroll.
//   • The sticky input never covers the latest message (the scroll container
//     has bottom padding and the input sits below it, not over it).
//   • Consecutive messages from the same author within ~3 min are grouped
//     (avatar/name shown once) to save vertical space.
//   • Subtle inline system messages (join/leave/stage changes) render as gray
//     centered text, not chat bubbles.
//   • On mobile the visualViewport API keeps the input above the keyboard and
//     re-pins the feed to the bottom when the keyboard opens.
//
// Persistence reuses the EXISTING space chat system: reads come from
// /api/social/spaces/[id]/comments and Supabase Realtime INSERTs on
// space_comments; posting goes through the Superfan-gated POST on the same
// route. System messages are ephemeral (passed in by the parent) and are never
// persisted.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { authReturnPath } from "@/lib/authReturn";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanParticipate } from "@/components/social/UpgradePrompt";
import { authFetch } from "@/lib/authClient";
import { ArrowDown, Send, SmilePlus } from "lucide-react";
import {
  useRoomComments,
  authorName,
  type ChatComment,
} from "@/components/social/rooms/useRoomComments";

export interface RoomSystemMessage {
  id: string;
  text: string;
  at: string; // ISO timestamp
}

// One reaction row (message × user × emoji). Kept flat so realtime INSERT/DELETE
// events map straight onto add/remove without re-aggregating from the server.
interface Reaction {
  user_id: string;
  emoji: string;
}

// The curated picker set — MUST match ALLOWED_EMOJI in the reactions API route.
const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "😮"];

// ChatComment / authorName / the load+realtime+post logic now live in
// useRoomComments so the audio room's floating comment overlay reads the same
// stream instead of opening a second `room_chat:${spaceId}` channel.

type FeedItem =
  | { kind: "message"; data: ChatComment; grouped: boolean }
  | { kind: "system"; data: RoomSystemMessage };

const GROUP_WINDOW_MS = 3 * 60 * 1000;
const NEAR_BOTTOM_PX = 100;


function timeLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function RoomChat({
  spaceId,
  systemMessages = [],
  accent = "purple",
  className = "",
}: {
  spaceId: string;
  systemMessages?: RoomSystemMessage[];
  accent?: "purple" | "orange";
  className?: string;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();

  const { comments, sendComment, sending, error, setError } =
    useRoomComments(spaceId);
  const [body, setBody] = useState("");
  const [newCount, setNewCount] = useState(0);
  // commentId -> its reaction rows; and which message's emoji picker is open.
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const accentBg = accent === "orange" ? "bg-brand-primary" : "bg-melori-purple";
  const accentRing =
    accent === "orange" ? "focus:border-brand-primary" : "focus:border-melori-purple";

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    autoScrollRef.current = true;
    setNewCount(0);
  }, []);

  // Track whether the user is pinned to the bottom. When they scroll up we stop
  // auto-following; when they return to the bottom we resume + clear the pill.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance <= NEAR_BOTTOM_PX;
    autoScrollRef.current = atBottom;
    if (atBottom) setNewCount(0);
  }, []);

  // Initial reactions load for the room (grouped per message client-side).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/social/spaces/${spaceId}/reactions`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled && Array.isArray(data.reactions)) {
          const rows = data.reactions as Array<{
            comment_id: string;
            user_id: string;
            emoji: string;
          }>;
          const map: Record<string, Reaction[]> = {};
          for (const r of rows) {
            (map[r.comment_id] ??= []).push({
              user_id: r.user_id,
              emoji: r.emoji,
            });
          }
          setReactions(map);
        }
      } catch {
        /* ignore — no reactions is fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Realtime reactions: mirror INSERT/DELETE from every participant. This reuses
  // the same Supabase Realtime path as the message feed above (postgres_changes)
  // so reactions sync live without a separate transport. DELETE carries the full
  // old row because the table is REPLICA IDENTITY FULL (migration 030).
  useEffect(() => {
    const channel = supabase
      .channel(`room_reactions:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "space_comment_reactions",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload) => {
          const r = payload.new as {
            comment_id: string;
            user_id: string;
            emoji: string;
          };
          setReactions((prev) => {
            const list = prev[r.comment_id] ?? [];
            if (list.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) {
              return prev; // dedupe our own optimistic add / duplicate events
            }
            return {
              ...prev,
              [r.comment_id]: [...list, { user_id: r.user_id, emoji: r.emoji }],
            };
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "space_comment_reactions",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload) => {
          const r = payload.old as {
            comment_id: string;
            user_id: string;
            emoji: string;
          };
          setReactions((prev) => {
            const list = prev[r.comment_id];
            if (!list) return prev;
            return {
              ...prev,
              [r.comment_id]: list.filter(
                (x) => !(x.user_id === r.user_id && x.emoji === r.emoji),
              ),
            };
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [spaceId]);

  // Toggle the current user's reaction on a message. Optimistic: flip locally
  // first, then persist via the API (which broadcasts to everyone else). The
  // realtime echo of our own write is deduped above.
  const toggleReaction = useCallback(
    async (commentId: string, emoji: string) => {
      if (!user) {
        router.push(`/social/auth?next=${encodeURIComponent(authReturnPath())}`);
        return;
      }
      const uid = user.id;
      setPickerFor(null);
      setReactions((prev) => {
        const list = prev[commentId] ?? [];
        const mine = list.some((x) => x.user_id === uid && x.emoji === emoji);
        return {
          ...prev,
          [commentId]: mine
            ? list.filter((x) => !(x.user_id === uid && x.emoji === emoji))
            : [...list, { user_id: uid, emoji }],
        };
      });
      try {
        const res = await authFetch(
          `/api/social/spaces/${spaceId}/reactions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment_id: commentId, emoji }),
          },
        );
        if (res.status === 401) router.push(`/social/auth?next=${encodeURIComponent(authReturnPath())}`);
      } catch {
        /* best-effort — realtime will reconcile if the write landed */
      }
    },
    [user, spaceId, router],
  );

  // Reaction bar (grouped chips + add-reaction picker) rendered under a message.
  const renderReactions = useCallback(
    (commentId: string) => {
      const list = reactions[commentId] ?? [];
      const groups = new Map<string, { count: number; mine: boolean }>();
      for (const r of list) {
        const g = groups.get(r.emoji) ?? { count: 0, mine: false };
        g.count += 1;
        if (user && r.user_id === user.id) g.mine = true;
        groups.set(r.emoji, g);
      }
      const open = pickerFor === commentId;
      return (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {[...groups.entries()].map(([emoji, { count, mine }]) => (
            <button
              key={emoji}
              type="button"
              onClick={() => toggleReaction(commentId, emoji)}
              aria-pressed={mine}
              aria-label={`${mine ? "Remove your" : "Add"} ${emoji} reaction — ${count} ${count === 1 ? "person" : "people"}`}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                mine
                  ? "border-melori-purple bg-melori-purple/20 text-melori-text"
                  : "border-melori-border/60 bg-melori-elevated/60 text-melori-muted hover:text-melori-text"
              }`}
            >
              <span className="text-sm leading-none">{emoji}</span>
              <span className="tabular-nums">{count}</span>
            </button>
          ))}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerFor((p) => (p === commentId ? null : commentId))}
              aria-label="Add reaction"
              aria-haspopup="true"
              aria-expanded={open}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-melori-border/60 text-melori-muted transition hover:text-melori-text"
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
            {open && (
              <div
                role="menu"
                className="absolute bottom-full left-0 z-20 mb-1 flex gap-1 rounded-full border border-melori-border bg-melori-elevated p-1 shadow-lg"
              >
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="menuitem"
                    onClick={() => toggleReaction(commentId, emoji)}
                    aria-label={`React with ${emoji}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition hover:bg-melori-purple/20"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    },
    [reactions, pickerFor, user, toggleReaction],
  );

  // Merge persisted messages + ephemeral system messages into one timeline,
  // sorted by time, with grouping flags computed on the message stream only.
  const feed = useMemo<FeedItem[]>(() => {
    const items: Array<
      | { t: number; kind: "message"; data: ChatComment }
      | { t: number; kind: "system"; data: RoomSystemMessage }
    > = [];
    for (const c of comments) {
      items.push({ t: new Date(c.created_at).getTime(), kind: "message", data: c });
    }
    for (const s of systemMessages) {
      items.push({ t: new Date(s.at).getTime(), kind: "system", data: s });
    }
    items.sort((a, b) => a.t - b.t);

    let prevAuthor: string | null = null;
    let prevT = 0;
    return items.map((it) => {
      if (it.kind === "system") {
        prevAuthor = null;
        return { kind: "system", data: it.data } as FeedItem;
      }
      const uid = it.data.user_id ?? it.data.id;
      const grouped =
        prevAuthor === uid && it.t - prevT < GROUP_WINDOW_MS;
      prevAuthor = uid;
      prevT = it.t;
      return { kind: "message", data: it.data, grouped } as FeedItem;
    });
  }, [comments, systemMessages]);

  // When the feed grows: if pinned to bottom, follow it; otherwise bump the
  // "new messages" pill counter.
  const lastLenRef = useRef(0);
  useLayoutEffect(() => {
    const grew = feed.length - lastLenRef.current;
    lastLenRef.current = feed.length;
    if (grew <= 0) return;
    if (autoScrollRef.current) {
      scrollToBottom();
    } else {
      setNewCount((n) => n + grew);
    }
  }, [feed.length, scrollToBottom]);

  // First paint → jump to bottom.
  useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile keyboard: when the visual viewport shrinks (keyboard opens) keep the
  // input visible and re-pin the feed to the newest message.
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onResize = () => {
      if (autoScrollRef.current) scrollToBottom();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [scrollToBottom]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = body;
      if (!text.trim() || sending) return;
      // Sending is an explicit user action → always follow to the bottom.
      autoScrollRef.current = true;
      const result = await sendComment(text);
      if (result.ok) {
        setBody("");
        requestAnimationFrame(() => scrollToBottom("smooth"));
      }
    },
    [body, sending, sendComment, scrollToBottom],
  );

  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${className}`}>
      {/* Click-away for an open reaction picker. */}
      {pickerFor && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setPickerFor(null)}
          className="fixed inset-0 z-10 cursor-default"
        />
      )}
      {/* Scrollable feed. bottom padding keeps the last message clear of input. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 hide-scrollbar"
      >
        {feed.length === 0 ? (
          <p className="py-8 text-center text-sm text-melori-muted">
            No messages yet. Say hi 👋
          </p>
        ) : (
          <ul className="space-y-1.5">
            {feed.map((item) => {
              if (item.kind === "system") {
                return (
                  <li
                    key={`sys-${item.data.id}`}
                    className="py-1 text-center text-[11px] text-melori-muted/80"
                  >
                    {item.data.text}
                  </li>
                );
              }
              const c = item.data;
              const name = authorName(c);
              const mine = !!user && c.user_id === user.id;
              if (item.grouped) {
                return (
                  <li key={c.id} className="pl-10 pr-1">
                    <p className="whitespace-pre-wrap break-words text-sm text-melori-text">
                      {c.body}
                    </p>
                    {renderReactions(c.id)}
                  </li>
                );
              }
              return (
                <li key={c.id} className="flex items-start gap-2 pt-1.5">
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-melori-purple/30 text-xs font-semibold">
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.avatar_url}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      name.charAt(0).toUpperCase()
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`truncate text-sm font-semibold ${
                          mine ? "text-melori-purple" : "text-melori-text"
                        }`}
                      >
                        {name}
                      </span>
                      <span className="shrink-0 text-[10px] text-melori-muted">
                        {timeLabel(c.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm text-melori-text">
                      {c.body}
                    </p>
                    {renderReactions(c.id)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {/* "N new messages" pill — only while scrolled up. */}
      {newCount > 0 && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className={`absolute bottom-[68px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full ${accentBg} px-3 py-1.5 text-xs font-semibold text-white shadow-lg`}
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {newCount} new message{newCount > 1 ? "s" : ""}
        </button>
      )}

      {/* Sticky composer. */}
      <div className="shrink-0 border-t border-melori-border/60 bg-melori-void/80 p-2 backdrop-blur">
        {canParticipate ? (
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit(e);
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Message the room…"
              className={`max-h-24 min-h-[40px] flex-1 resize-none rounded-2xl border border-melori-border bg-melori-elevated px-3 py-2 text-sm text-melori-text outline-none transition ${accentRing}`}
            />
            <button
              type="submit"
              disabled={sending || !body.trim()}
              aria-label="Send message"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accentBg} text-white transition disabled:opacity-40`}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <button
            data-native-hide
            type="button"
            onClick={() => router.push("/membership")}
            className="w-full rounded-2xl border border-melori-border bg-melori-elevated px-3 py-2.5 text-center text-sm text-melori-muted transition hover:text-melori-text"
          >
            Go Superfan to chat in the room
          </button>
        )}
        {error && (
          <p className="mt-1 px-2 text-xs text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
