"use client";

// CinemaChat — the room chat, as a floating stream beside the audience rail.
//
// History: until 1 Oct 2026 this was a five-line overlay on the shared screen
// that faded each line after eight seconds, so a comment made while you looked
// away was gone. It then became a boxed, scrollable panel under the stage.
// The Clubhouse-style layout (13 Oct 2026) keeps that persistent log but takes
// the box away: the room shows the newest few lines floating over the bottom
// of the lower region, older ones fading toward the top, and tapping them
// opens the WHOLE log as a bottom sheet. Nothing is lost; the full history is
// one tap away and the room keeps its height for the seats and the listeners.
//
// The composer sits in the bottom dock (CinemaRoomScreen), so the stream has
// no frame around it. The sheet covers that dock, so the room also hands the
// same composer in through `composer` and the sheet renders it at its foot —
// otherwise opening the chat left nowhere to type (Karl, 20 Oct 2026).
//
// Moderation lives in the sheet: the host, a badged moderator or the author can
// delete a line, and every open room drops it through the realtime DELETE event
// in useRoomComments.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Flag, Trash2, X } from "lucide-react";
import { authorName, type ChatComment } from "@/components/social/rooms/useRoomComments";
import { cinemaAvatarColor, cinemaInitials } from "@/lib/cinemaAvatar";

// Within this many pixels of the bottom counts as "reading the latest", so a
// new line scrolls into view. Further up, the reader is in the history and we
// leave them there and offer a jump button instead of yanking the scroll.
const STICK_TO_BOTTOM_PX = 48;

/** How many of the newest messages float in the room before the sheet. */
export const CINEMA_CHAT_STREAM_LINES = 4;

// Older lines fade toward the top of the stream. Set as both the standard and
// the -webkit- property: iOS Safari still needs the prefix.
const STREAM_FADE = "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.35) 30%, #000 75%)";

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
  /** The room's composer, shown at the foot of the open sheet. Omitted for
   *  viewers who cannot comment (signed out, not joined). */
  composer?: ReactNode;
}

function ChatAvatar({ comment, name, size }: { comment: ChatComment; name: string; size: "sm" | "md" }) {
  const box = size === "sm" ? "h-5 w-5 text-[9px]" : "mt-0.5 h-6 w-6 text-[10px]";
  if (comment.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={comment.avatar_url}
        alt=""
        loading="lazy"
        className={`${box} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      className={`${box} grid shrink-0 place-items-center rounded-full font-bold text-white`}
      style={{ backgroundColor: cinemaAvatarColor(comment.user_id) }}
    >
      {cinemaInitials(name)}
    </span>
  );
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
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const lastCountRef = useRef(comments.length);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    atBottomRef.current = true;
    setUnseen(0);
  }, []);

  // Follow new lines only when the reader is already at the bottom. While the
  // sheet is closed there is nothing to scroll; the stream shows the newest.
  useLayoutEffect(() => {
    const added = comments.length - lastCountRef.current;
    lastCountRef.current = comments.length;
    if (!open) return;
    if (atBottomRef.current) {
      scrollToBottom();
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [comments.length, open, scrollToBottom]);

  // Opening the sheet lands on the newest message, with focus on Close.
  useLayoutEffect(() => {
    if (!open) return;
    scrollToBottom();
    closeRef.current?.focus();
  }, [open, scrollToBottom]);

  const close = useCallback(() => {
    setOpen(false);
    setUnseen(0);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_TO_BOTTOM_PX;
    atBottomRef.current = atBottom;
    if (atBottom) setUnseen(0);
  };

  const stream = comments.slice(-CINEMA_CHAT_STREAM_LINES);
  const newest = comments[comments.length - 1];

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col justify-end"
      data-testid="cinema-chat"
      aria-label="Room chat"
    >
      {/* Screen readers hear each new line once, here, whether or not the
          sheet is open. */}
      <p className="sr-only" aria-live="polite">
        {newest ? `${authorName(newest)}: ${newest.body}` : ""}
      </p>

      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        data-testid="cinema-chat-open"
        aria-label={`Open chat (${comments.length})`}
        aria-haspopup="dialog"
        className="flex min-h-0 w-full flex-1 flex-col justify-end gap-1 overflow-hidden rounded-lg px-1 pb-0.5 text-left"
      >
        <span
          className="flex min-h-0 w-full flex-col justify-end gap-1 overflow-hidden"
          data-testid="cinema-chat-stream"
          style={{ maskImage: STREAM_FADE, WebkitMaskImage: STREAM_FADE }}
        >
          {stream.length === 0 ? (
            <span className="text-xs text-white/40">No messages yet. Say hi to the room.</span>
          ) : (
            stream.map((comment) => {
              const name = authorName(comment);
              return (
                <span
                  key={comment.id}
                  className="flex min-w-0 shrink-0 items-center gap-1.5"
                  data-testid="cinema-chat-stream-line"
                >
                  <ChatAvatar comment={comment} name={name} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-white/85">
                    <span className="font-semibold text-melori-text">{name}</span>{" "}
                    {comment.body}
                  </span>
                </span>
              );
            })
          )}
        </span>
        {comments.length > 0 && (
          <span className="shrink-0 text-[11px] font-medium text-melori-accent">
            Open chat ({comments.length})
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50"
          onClick={close}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Room chat"
            data-testid="cinema-chat-sheet"
            onClick={(event) => event.stopPropagation()}
            className="relative flex h-[70dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-cinema-border bg-melori-elevated pb-[env(safe-area-inset-bottom)] shadow-2xl animate-fade-in"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
              <h2 className="text-base font-semibold text-melori-text">
                Room chat <span className="text-melori-muted">· {comments.length}</span>
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="Close chat"
                data-testid="cinema-chat-close"
                className="grid h-9 w-9 place-items-center rounded-full text-melori-muted hover:bg-white/5 hover:text-melori-text"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </header>

            <div
              ref={listRef}
              onScroll={onScroll}
              role="log"
              aria-relevant="additions"
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3"
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
                      <ChatAvatar comment={comment} name={name} size="md" />
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
                          onClick={() => {
                            // The report sheet is its own dialog; close this
                            // one first so Escape and focus belong to it.
                            setOpen(false);
                            onReport?.(comment);
                          }}
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
              <div className="pointer-events-none relative h-0">
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-melori-purple px-3 py-1 text-xs font-semibold text-white shadow-lg"
                >
                  {unseen} new {unseen === 1 ? "message" : "messages"}
                </button>
              </div>
            )}

            {composer && (
              <div
                className="flex shrink-0 border-t border-white/[0.06] px-3 py-2"
                data-testid="cinema-chat-sheet-composer"
              >
                {composer}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

export default CinemaChat;
