"use client";

// SpacesChat — the room chat that fills the bottom of an MM Spaces room.
//
// In the room it shows only the newest CHAT_VISIBLE_LINES lines, the older ones
// fading out toward the top (Karl, 13 Oct 2026: "5 or 6 rows of disappearing
// text"), so the stage and the audience keep the screen. "Open chat" shows the
// whole log full screen, which follows new lines only while the reader is at
// the bottom (scrolled up into history, they get a "new messages" button
// instead of being yanked). The host, a moderator or the author can
// delete a line, and it disappears from every open room. Anyone else can report
// a line, which goes to the moderation queue.
//
// Spaces' own component (Karl, 2 Oct 2026: no shared room code with Cinema).

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Flag, Trash2, X } from "lucide-react";
import {
  spaceChatAuthor,
  type SpaceChatMessage,
} from "@/components/social/spaces/useSpaceChat";
import { spacesAvatarColor, spacesInitials } from "@/lib/spacesAvatar";

const STICK_TO_BOTTOM_PX = 48;

/** Lines visible in the room before older ones fade away. */
export const CHAT_VISIBLE_LINES = 6;

interface SpacesChatProps {
  messages: readonly SpaceChatMessage[];
  viewerId?: string | null;
  canModerate?: boolean;
  stageIds?: ReadonlySet<string>;
  onDelete?: (messageId: string) => void;
  onReport?: (message: SpaceChatMessage) => void;
  composer?: ReactNode;
}

export function SpacesChat({
  messages,
  viewerId,
  canModerate,
  stageIds,
  onDelete,
  onReport,
  composer,
}: SpacesChatProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastCountRef = useRef(messages.length);
  const [unseen, setUnseen] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const scrollToBottom = () => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    atBottomRef.current = true;
    setUnseen(0);
  };

  useLayoutEffect(() => {
    const added = messages.length - lastCountRef.current;
    lastCountRef.current = messages.length;
    if (atBottomRef.current) scrollToBottom();
    else if (added > 0) setUnseen((count) => count + added);
  }, [messages.length]);

  useEffect(() => {
    if (expanded) scrollToBottom();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight <
      STICK_TO_BOTTOM_PX;
    atBottomRef.current = atBottom;
    if (atBottom) setUnseen(0);
  };

  const renderLine = (message: SpaceChatMessage, compact = false) => {
    const name = spaceChatAuthor(message);
    const mine = Boolean(viewerId && message.user_id === viewerId);
    const deletable = Boolean(onDelete && (canModerate || mine));
    const reportable = Boolean(onReport && viewerId && !mine && !canModerate);
    const onStage = Boolean(message.user_id && stageIds?.has(message.user_id));
    return (
      <div
        key={message.id}
        className="flex items-start gap-2"
        data-testid="spaces-chat-line"
      >
        {message.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.avatar_url}
            alt=""
            loading="lazy"
            className={`mt-0.5 shrink-0 rounded-full object-cover ${compact ? "h-5 w-5" : "h-7 w-7"}`}
          />
        ) : (
          <span
            className={`mt-0.5 grid shrink-0 place-items-center rounded-full font-bold text-white ${compact ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-[11px]"}`}
            style={{ backgroundColor: spacesAvatarColor(message.user_id) }}
          >
            {spacesInitials(name)}
          </span>
        )}
        {compact ? (
          <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-melori-text/90 [overflow-wrap:anywhere]">
            <span className="mr-1.5 text-xs font-semibold text-melori-text">
              {name}
              {onStage && (
                <span className="ml-1 font-medium text-melori-accent">·</span>
              )}
            </span>
            {message.body}
          </p>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-melori-text">
              {name}
              {onStage && (
                <span className="ml-1.5 font-medium text-melori-accent">
                  on stage
                </span>
              )}
            </p>
            <p className="text-[13.5px] leading-snug text-melori-text/90 [overflow-wrap:anywhere]">
              {message.body}
            </p>
          </div>
        )}
        {deletable && (
          <button
            type="button"
            onClick={() => onDelete?.(message.id)}
            data-testid="spaces-chat-delete"
            aria-label={`Delete message from ${name}`}
            title="Delete message"
            className="shrink-0 rounded-full p-1.5 text-melori-muted/60 transition hover:bg-white/5 hover:text-melori-danger"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {reportable && (
          <button
            type="button"
            onClick={() => onReport?.(message)}
            data-testid="spaces-chat-report"
            aria-label={`Report message from ${name}`}
            title="Report message"
            className="shrink-0 rounded-full p-1.5 text-melori-muted/50 transition hover:bg-white/5 hover:text-melori-warning"
          >
            <Flag className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    );
  };

  const recent = messages.slice(-CHAT_VISIBLE_LINES);

  if (!expanded) {
    return (
      <section
        aria-label="Room chat"
        data-testid="spaces-chat"
        className="flex shrink-0 flex-col"
      >
        <div className="flex items-center justify-between pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-melori-muted">
            Room chat
          </p>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            data-testid="spaces-chat-open"
            className="text-xs font-semibold text-melori-accent hover:underline"
          >
            Open chat
            {messages.length > CHAT_VISIBLE_LINES
              ? ` (${messages.length})`
              : ""}
          </button>
        </div>
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          data-testid="spaces-chat-log"
          className="flex flex-col justify-end gap-1.5 overflow-hidden"
          style={{
            // Older lines fade toward the top, so the strip reads as a
            // passing stream rather than a box.
            maskImage: "linear-gradient(to bottom, transparent 0%, black 45%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 45%)",
          }}
        >
          {recent.length === 0 ? (
            <p className="py-2 text-xs text-melori-muted">
              No messages yet. Say hi to the room.
            </p>
          ) : (
            recent.map((message) => renderLine(message, true))
          )}
        </div>
        {composer && <div className="shrink-0 pt-2">{composer}</div>}
      </section>
    );
  }

  return (
    <section
      aria-label="Room chat"
      data-testid="spaces-chat"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-melori-void pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center justify-between px-4 pb-1 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-melori-muted">
          Room chat
        </p>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          data-testid="spaces-chat-close"
          aria-label="Back to the room"
          className="rounded-full p-2 text-melori-muted hover:bg-white/5 hover:text-melori-text"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div
        ref={listRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        data-testid="spaces-chat-log"
        className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-2"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-center text-xs text-melori-muted">
            No messages yet. Say hi to the room.
          </p>
        ) : (
          messages.map((message) => renderLine(message))
        )}
      </div>
      {unseen > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-melori-purple px-3 py-1 text-xs font-semibold text-white shadow-lg"
        >
          {unseen} new {unseen === 1 ? "message" : "messages"}
        </button>
      )}
      {composer && (
        <div className="mx-auto w-full max-w-2xl shrink-0 border-t border-melori-border p-2">
          {composer}
        </div>
      )}
    </section>
  );
}

export default SpacesChat;
