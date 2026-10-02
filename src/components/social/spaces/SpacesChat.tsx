"use client";

// SpacesChat — the room chat that fills the bottom of an MM Spaces room.
//
// A persistent log, newest at the bottom, that follows new lines only while the
// reader is at the bottom (scrolled up into history, they get a "new messages"
// button instead of being yanked). The host, a moderator or the author can
// delete a line, and it disappears from every open room. Anyone else can report
// a line, which goes to the moderation queue.
//
// Spaces' own component (Karl, 2 Oct 2026: no shared room code with Cinema).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Flag, Trash2 } from "lucide-react";
import { spaceChatAuthor, type SpaceChatMessage } from "@/components/social/spaces/useSpaceChat";
import { spacesAvatarColor, spacesInitials } from "@/lib/spacesAvatar";

const STICK_TO_BOTTOM_PX = 48;

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
      aria-label="Room chat"
      data-testid="spaces-chat"
      className="relative flex min-h-[8rem] flex-1 flex-col overflow-hidden rounded-2xl border border-melori-border bg-melori-surface"
    >
      <p className="shrink-0 px-3.5 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-melori-muted">
        Room chat
      </p>
      <div
        ref={listRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        data-testid="spaces-chat-log"
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-2"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-center text-xs text-melori-muted">
            No messages yet. Say hi to the room.
          </p>
        ) : (
          messages.map((message) => {
            const name = spaceChatAuthor(message);
            const mine = Boolean(viewerId && message.user_id === viewerId);
            const deletable = Boolean(onDelete && (canModerate || mine));
            const reportable = Boolean(onReport && viewerId && !mine && !canModerate);
            const onStage = Boolean(message.user_id && stageIds?.has(message.user_id));
            return (
              <div key={message.id} className="flex items-start gap-2" data-testid="spaces-chat-line">
                {message.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={message.avatar_url}
                    alt=""
                    loading="lazy"
                    className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: spacesAvatarColor(message.user_id) }}
                  >
                    {spacesInitials(name)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-melori-text">
                    {name}
                    {onStage && (
                      <span className="ml-1.5 font-medium text-melori-accent">on stage</span>
                    )}
                  </p>
                  <p className="text-[13.5px] leading-snug text-melori-text/90 [overflow-wrap:anywhere]">
                    {message.body}
                  </p>
                </div>
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
          })
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
      {composer && <div className="shrink-0 border-t border-melori-border p-2">{composer}</div>}
    </section>
  );
}

export default SpacesChat;
