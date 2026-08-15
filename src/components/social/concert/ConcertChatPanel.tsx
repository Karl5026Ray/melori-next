"use client";

import { useEffect, useRef, useState } from "react";
import { Flame, SendHorizontal } from "lucide-react";
import { authorName, type ChatComment } from "@/components/social/rooms/useRoomComments";
import { CONCERT_CHAT_MAX_LENGTH } from "@/lib/concertStage";

/**
 * The battle's live chat column.
 *
 * The comment stream is owned by the caller (ConcertLiveStage holds the single
 * useRoomComments subscription for the room), because only ONE caller may own
 * the `room_chat:${spaceId}` channel — see the note on useRoomComments.
 */
export function ConcertChatPanel({
  comments,
  sending,
  error,
  heatCount,
  onSend,
}: {
  comments: readonly ChatComment[];
  sending: boolean;
  error: string;
  heatCount: number;
  onSend: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLUListElement | null>(null);

  // Pin to the newest message. Chat is the one region where a jump to the
  // bottom is the correct behaviour rather than a scroll hijack.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [comments.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    onSend(text);
  };

  return (
    <section
      className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/[0.06] bg-[#16161c] p-1.5"
      data-testid="concert-chat"
      aria-label="Live chat"
    >
      <p className="mb-1 flex shrink-0 items-center justify-between gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-white/40">
        <span>Live chat</span>
        <span className="flex items-center gap-0.5 text-[#ff8f4d]">
          <Flame className="h-2.5 w-2.5" aria-hidden />
          <span className="tabular-nums">{heatCount}</span>
        </span>
      </p>

      <ul
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="concert-chat-list"
      >
        {comments.map((comment) => (
          <li key={comment.id} className="text-[11px] leading-snug">
            <span className="font-bold text-[#f5e56b]">{authorName(comment)}</span>{" "}
            <span className="text-white/70">{comment.body}</span>
          </li>
        ))}
        {comments.length === 0 ? (
          <li className="text-[10px] text-white/30">Be the first to hype the stage.</li>
        ) : null}
      </ul>

      {error ? <p className="mt-1 text-[10px] text-[#ff8fa3]">{error}</p> : null}

      <form
        className="mt-1 flex shrink-0 items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={CONCERT_CHAT_MAX_LENGTH}
          placeholder="Say something…"
          aria-label="Send a chat message"
          data-testid="concert-chat-input"
          className="min-w-0 flex-1 rounded-full border border-white/[0.08] bg-black/40 px-2 py-1 text-[11px] text-white placeholder:text-white/25 focus:border-[#f5e56b]/40 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          aria-label="Send"
          data-testid="concert-chat-send"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#f5e56b] text-black transition active:scale-95 disabled:opacity-35"
        >
          <SendHorizontal className="h-3 w-3" aria-hidden />
        </button>
      </form>
    </section>
  );
}
