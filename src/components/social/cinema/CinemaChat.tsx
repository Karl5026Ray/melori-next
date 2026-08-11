"use client";

import { useEffect, useRef, useState } from "react";
import { authorName, type ChatComment } from "@/components/social/rooms/useRoomComments";

export const CINEMA_COMMENT_TTL_MS = 8_000;
export const CINEMA_COMMENT_EXIT_MS = 600;

type ExpiringComment = ChatComment & { expiresAt: number; exitingAt?: number };

/**
 * Transient presentation over the shared Cinema media area. It never deletes
 * comments: persistence remains in `space_comments`; only this client-side
 * display list expires.
 */
export function CinemaChat({ comments }: { comments: readonly ChatComment[] }) {
  const [visible, setVisible] = useState<ExpiringComment[]>([]);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    const now = Date.now();
    setVisible((current) => {
      // Keep a line around for its short exit transition even when a new
      // comment arrives while it is fading. The final slice still guarantees
      // that this presentation layer never exposes more than five lines.
      const next = current.filter(
        (comment) =>
          (!comment.exitingAt && comment.expiresAt > now) ||
          (comment.exitingAt && comment.exitingAt + CINEMA_COMMENT_EXIT_MS > now),
      );
      for (const comment of comments) {
        if (seenRef.current.has(comment.id)) continue;
        seenRef.current.add(comment.id);
        next.push({ ...comment, expiresAt: now + CINEMA_COMMENT_TTL_MS });
      }
      // Cinema intentionally remains a fleeting, readable overlay rather than
      // a scrolling transcript. Five short lines leave the screen legible and
      // older comments fade away on their own.
      return next.slice(-5);
    });
  }, [comments]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setVisible((current) =>
        current
          .filter(
            (comment) =>
              !comment.exitingAt || comment.exitingAt + CINEMA_COMMENT_EXIT_MS > now,
          )
          .map((comment) =>
            comment.expiresAt <= now && !comment.exitingAt
              ? { ...comment, exitingAt: now }
              : comment,
          ),
      );
    }, 300);
    return () => window.clearInterval(timer);
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-[5.75rem] left-2 z-20 max-h-[42%] w-[min(66%,21rem)] overflow-hidden bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pb-2 pt-8 sm:bottom-[6.5rem] sm:left-3 sm:px-3"
      data-testid="cinema-comment-overlay"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Cinema comments"
    >
      <div className="space-y-1.5">
        {visible.map((comment, index) => (
          <p
            key={comment.id}
            data-testid="cinema-comment-line"
            data-cinema-comment-age={visible.length - index}
            data-cinema-comment-exiting={comment.exitingAt ? "true" : undefined}
            className="cinema-comment-line text-[12px] leading-snug text-white/80"
          >
            <span className="cinema-comment-line-content">
              <span className="font-semibold text-cinema-gold">{authorName(comment)}</span>{" "}
              <span>{comment.body}</span>
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

export default CinemaChat;
