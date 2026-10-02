"use client";

// CinemaChat — the room chat, docked below the stage.
//
// It used to be a five-line overlay on top of the shared screen that faded
// each line after eight seconds, which meant a comment made while you looked
// away was simply gone and the bottom of the room was empty space. Karl asked
// for that space to be used: this is a persistent, scrollable log below the
// guests, with its composer at the bottom (Clubhouse's 2022 in-room chat is
// the model).
//
// Moderation is part of the panel, not an afterthought: the host, a badged
// moderator or the author can delete a line, and every open room drops it
// through the realtime DELETE event in useRoomComments.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Flag, Trash2 } from "lucide-react";
import { authorName, type ChatComment } from "@/components/social/rooms/useRoomComments";
import { cinemaAvatarColor, cinemaInitials } from "@/lib/cinemaAvatar";

// Within this many pixels of the bottom counts as "reading the latest", so a
// new line scrolls into view. Further up, the reader is in the history and we
// leave them there and offer a jump button instead of yanking the scroll.
const STICK_TO_BOTTOM_PX = 48;

interface CinemaChatProps {
  comments: readonly ChatComment[];
  viewerId?: string | null;
  /** Host or badged moderator: may delete anyone's message. */
  canModerate?: boolean;
  /** user ids currently on stage, to tag their lines. */
  stageIds?: ReadonlySet<string>;
  onDelete?: (commentId: string) => void;
  /** Anyone who is not a moderator can report someone else's line. */
  onReport?: (comment: ChatComment) => void;
  /** The composer form, owned by CinemaRoomScreen so there is one send path. */
  composer?: ReactNode;
}

export function CinemaChat({
  comments,
  viewerId,
  canModerate,
  stageIds,
  onDelete,
  onReport,
  composer,
}: CinemaChatProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const lastCountRef = useRef(comments.length);

  const scrollToBottom = () => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    atBottomRef.current = true;
    setUnseen(0);
  };

  // Follow new lines only when the reader is already at the bottom.
  useLayoutEffect(() => {
    const added = comments.length - lastCountRef.current;
    lastCountRef.current = comments.length;
    if (atBottomRef.current) {
      scrollToBottom();
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [comments.length]);

  // First paint lands on the newest message.
  useEffect(() => {
    scrollToBottom();
  }, []);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_TO_BOTTOM_PX;
    atBottomRef.current = atBottom;
    if (atBottom) setUnseen(0);
  };

  return (
    <section
      className="relative flex min-h-[7.5rem] flex-1 flex-col overflow-hidden rounded-xl border border-melori-border bg-melori-surface"
      data-testid="cinema-chat"
      aria-label="Room chat"
    >
      <div
        ref={listRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2.5"
        data-testid="cinema-chat-log"
      >
        {comments.length === 0 ? (
          <p className="m-auto text-center text-xs text-white/35">
            No messages yet. Say hi to the room.
          </p>
        ) : (
          comments.map((comment) => {
            const name = authorName(comment);
            const mine = Boolean(viewerId && comment.user_id === viewerId);
            const deletable = Boolean(onDelete && (canModerate || mine));
            const reportable = Boolean(onReport && viewerId && !mine && !canModerate);
            const onStage = Boolean(comment.user_id && stageIds?.has(comment.user_id));
            return (
              <div
                key={comment.id}
                className="group flex items-start gap-2"
                data-testid="cinema-chat-line"
              >
                {comment.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={comment.avatar_url}
                    alt=""
                    loading="lazy"
                    className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: cinemaAvatarColor(comment.user_id) }}
                  >
                    {cinemaInitials(name)}
                  </span>
                )}
                <p className="min-w-0 flex-1 text-[13px] leading-snug text-white/85 [overflow-wrap:anywhere]">
                  <span className="font-semibold text-melori-text">{name}</span>
                  {onStage && (
                    <span className="ml-1.5 text-[11px] font-medium text-melori-accent">on stage</span>
                  )}{" "}
                  <span>{comment.body}</span>
                </p>
                {deletable && (
                  <button
                    type="button"
                    onClick={() => onDelete?.(comment.id)}
                    data-testid="cinema-chat-delete"
                    aria-label={`Delete message from ${name}`}
                    title="Delete message"
                    className="shrink-0 rounded-full p-1 text-white/25 transition hover:bg-white/5 hover:text-red-400 focus-visible:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
                {reportable && (
                  <button
                    type="button"
                    onClick={() => onReport?.(comment)}
                    data-testid="cinema-chat-report"
                    aria-label={`Report message from ${name}`}
                    title="Report message"
                    className="shrink-0 rounded-full p-1 text-white/25 transition hover:bg-white/5 hover:text-melori-warning"
                  >
                    <Flag className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {unseen > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-14 left-1/2 -translate-x-1/2 rounded-full bg-melori-purple px-3 py-1 text-xs font-semibold text-white shadow-lg"
        >
          {unseen} new {unseen === 1 ? "message" : "messages"}
        </button>
      )}

      {composer && <div className="shrink-0 border-t border-white/[0.06] p-1.5">{composer}</div>}
    </section>
  );
}

export default CinemaChat;
