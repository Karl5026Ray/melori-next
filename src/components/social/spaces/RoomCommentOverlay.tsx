"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { authorName, type ChatComment } from "@/components/social/rooms/useRoomComments";

/**
 * Live-stream style comment overlay for audio rooms.
 *
 * Comments float up the LEFT side over the participant grid and fade out,
 * rather than living in a panel that covers it. The grid is the point of the
 * room, so chat is not allowed to occlude it permanently.
 *
 * Two deliberate behaviours:
 *  • Backlog is never replayed. On mount we mark every comment already in the
 *    feed as seen, so opening a room that has been running for an hour does
 *    not dump sixty stale messages up the screen. Only messages that arrive
 *    while you are watching float.
 *  • pointer-events-none throughout, so the overlay can sit on top of the grid
 *    without stealing taps from the tiles underneath it.
 */
const VISIBLE_MS = 9000;
const MAX_VISIBLE = 4;

export default function RoomCommentOverlay({
  comments,
  className = "",
}: {
  comments: ChatComment[];
  className?: string;
}) {
  const [live, setLive] = useState<ChatComment[]>([]);
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    // First run: swallow the backlog.
    if (seenRef.current === null) {
      seenRef.current = new Set(comments.map((c) => c.id));
      return;
    }
    const seen = seenRef.current;
    const fresh = comments.filter((c) => !seen.has(c.id));
    if (fresh.length === 0) return;
    for (const c of fresh) seen.add(c.id);
    setLive((prev) => [...prev, ...fresh].slice(-MAX_VISIBLE));

    const timers = fresh.map((c) =>
      setTimeout(
        () => setLive((prev) => prev.filter((x) => x.id !== c.id)),
        VISIBLE_MS,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [comments]);

  if (live.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end gap-2 px-4 pb-3 ${className}`}
    >
      {live.map((c) => (
        <div
          key={c.id}
          className="animate-fade-in flex max-w-[78%] items-start gap-2 rounded-2xl bg-black/55 px-2.5 py-1.5 backdrop-blur-sm"
        >
          <Image
            src={c.avatar_url || "/favicon.png"}
            alt=""
            width={24}
            height={24}
            unoptimized
            className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
          />
          <p className="min-w-0 text-[14px] leading-snug break-words">
            <span className="font-semibold text-melori-muted">
              {authorName(c)}
            </span>{" "}
            <span className="text-melori-text">{c.body}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
