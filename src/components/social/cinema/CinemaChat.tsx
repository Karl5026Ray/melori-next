"use client";

import { useEffect, useRef, useState } from "react";
import { authorName, type ChatComment } from "@/components/social/rooms/useRoomComments";

export const CINEMA_COMMENT_TTL_MS = 8_000;

type ExpiringComment = ChatComment & { expiresAt: number };

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
      const next = current.filter((comment) => comment.expiresAt > now);
      for (const comment of comments) {
        if (seenRef.current.has(comment.id)) continue;
        seenRef.current.add(comment.id);
        next.push({ ...comment, expiresAt: now + CINEMA_COMMENT_TTL_MS });
      }
      return next.slice(-6);
    });
  }, [comments]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setVisible((current) => current.filter((comment) => comment.expiresAt > now));
    }, 300);
    return () => window.clearInterval(timer);
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 max-h-[55%] overflow-hidden bg-gradient-to-t from-black/70 via-black/20 to-transparent px-3 pb-3 pt-10"
      data-testid="cinema-comment-overlay"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Cinema comments"
    >
      <div className="space-y-1.5">
        {visible.map((comment) => (
          <p key={comment.id} data-testid="cinema-comment" className="text-[12px] leading-snug text-white/80">
            <span className="font-semibold text-cinema-gold">{authorName(comment)}</span>{" "}
            <span>{comment.body}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

export default CinemaChat;
