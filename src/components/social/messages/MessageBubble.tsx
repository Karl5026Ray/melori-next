"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Trash2, SmilePlus } from "lucide-react";
import { Message } from "@/types/social";
import { formatTimeAgo } from "@/lib/social";
import { supabase } from "@/lib/supabase";
import { MESSAGE_MEDIA_BUCKET, REACTION_EMOJI } from "@/lib/messageMedia";

// Signed links for private message photos, shared across bubbles so scrolling
// back and forth doesn't re-sign the same file. Links last an hour; we refresh
// after 50 minutes.
const signedCache = new Map<string, { url: string; at: number }>();
const SIGN_TTL_S = 3600;

function MessagePhoto({
  path,
  width,
  height,
  localUrl,
}: {
  path: string;
  width?: number;
  height?: number;
  localUrl?: string;
}) {
  const [url, setUrl] = useState<string | null>(() => {
    if (localUrl) return localUrl;
    const hit = signedCache.get(path);
    return hit && Date.now() - hit.at < 50 * 60 * 1000 ? hit.url : null;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url || !path) return;
    let cancelled = false;
    // Members-only read (storage policy message_media_read_member, mig. 092).
    supabase.storage
      .from(MESSAGE_MEDIA_BUCKET)
      .createSignedUrl(path, SIGN_TTL_S)
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.signedUrl) {
          signedCache.set(path, { url: data.signedUrl, at: Date.now() });
          setUrl(data.signedUrl);
        } else {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, url]);

  const ratio = width && height ? `${width} / ${height}` : "4 / 3";
  if (failed) {
    return (
      <div className="flex h-24 w-48 items-center justify-center rounded-xl bg-black/30 text-xs opacity-70">
        Photo unavailable
      </div>
    );
  }
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-xl bg-black/30"
      style={{ aspectRatio: ratio, width: "min(16rem, 60vw)" }}
      aria-label="Open photo"
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Photo" className="h-full w-full object-cover" loading="lazy" />
      )}
    </a>
  );
}

export function MessageBubble({
  message,
  isMe,
  myId,
  onDelete,
  onReact,
  status,
  onRetry,
  seen,
}: {
  message: Message & { _localUrls?: string[] };
  isMe: boolean;
  /** The viewer's id — to highlight their own reactions. */
  myId?: string;
  // Called when the sender chooses to delete their own message. Optional so
  // read-only contexts can omit it.
  onDelete?: (id: string) => void;
  /** Toggle a reaction. Double-tap/double-click sends the first one (❤️). */
  onReact?: (id: string, emoji: string) => void;
  // Set while an optimistically-rendered message is still in flight, or once
  // the send has failed. Undefined once the server has confirmed the message.
  status?: "sending" | "failed";
  onRetry?: () => void;
  /** Show "Seen" under this message (the other person has read up to it). */
  seen?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(false);
  const isDeleted = !!message.deleted_at;
  const isPending = status === "sending";
  const hasFailed = status === "failed";
  const canReact = !!onReact && !isDeleted && !status;
  const photos = message.attachments ?? [];

  // Double-tap (touch) / double-click → like. Long-press → reaction picker.
  const lastTap = useRef(0);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const like = () => canReact && onReact!(message.id, REACTION_EMOJI[0]);
  const onTouchStart = () => {
    if (!canReact) return;
    pressTimer.current = setTimeout(() => setPicking(true), 450);
  };
  const onTouchEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    const now = Date.now();
    if (now - lastTap.current < 300) like();
    lastTap.current = now;
  };

  // Group reactions: emoji → { count, mine }.
  const grouped = new Map<string, { count: number; mine: boolean }>();
  for (const r of message.reactions ?? []) {
    const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
    g.count += 1;
    if (r.user_id === myId) g.mine = true;
    grouped.set(r.emoji, g);
  }

  return (
    <div
      className={`group flex ${
        isMe ? "justify-end" : "justify-start"
      } animate-slide-up`}
    >
      <div
        className={`flex items-end gap-2 max-w-[75%] ${
          isMe ? "flex-row-reverse" : ""
        }`}
      >
        {!isMe && (
          <img
            src={message.sender?.avatar_url || "/favicon.png"}
            className="w-6 h-6 rounded-full mb-1 object-cover"
            alt={message.sender?.display_name}
          />
        )}
        <div className={`relative flex flex-col ${isMe ? "items-end" : "items-start"}`}>
          <div
            onDoubleClick={like}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchMove={() => pressTimer.current && clearTimeout(pressTimer.current)}
            className={`px-4 py-2.5 rounded-2xl text-sm select-text ${
              isMe ? "msg-bubble-sent" : "msg-bubble-received"
            } ${isPending ? "opacity-60" : ""} ${
              hasFailed ? "ring-1 ring-red-500/70" : ""
            }`}
          >
            {isDeleted ? (
              <p className="italic opacity-60">Message deleted</p>
            ) : (
              <>
                {photos.length > 0 && (
                  <div className={`mb-1 flex flex-col gap-1 ${message.content ? "" : "-mx-2 -mt-1"}`}>
                    {photos.map((p, i) => (
                      <MessagePhoto
                        key={p.path || i}
                        path={p.path}
                        width={p.width}
                        height={p.height}
                        localUrl={message._localUrls?.[i]}
                      />
                    ))}
                  </div>
                )}
                {message.content && (
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                )}
              </>
            )}
            {hasFailed ? (
              <span className="mt-1 flex items-center justify-end gap-2 text-[10px]">
                <span className="text-red-300">Not sent</span>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-0.5 font-semibold text-red-200 underline hover:text-white"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Retry
                  </button>
                )}
              </span>
            ) : (
              <span
                className={`text-[10px] mt-1 block text-right ${
                  isMe ? "text-white/60" : "text-melori-muted"
                }`}
              >
                {isPending ? "Sending…" : formatTimeAgo(message.created_at)}
              </span>
            )}
          </div>

          {/* Reaction chips — tap one to add/remove yours. */}
          {grouped.size > 0 && !isDeleted && (
            <div className={`-mt-1.5 flex flex-wrap gap-1 ${isMe ? "justify-end" : ""}`}>
              {[...grouped.entries()].map(([emoji, g]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => canReact && onReact!(message.id, emoji)}
                  aria-label={`${emoji} ${g.count}${g.mine ? ", including you" : ""}`}
                  className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs leading-none ${
                    g.mine
                      ? "border-brand-primary bg-brand-primary/20"
                      : "border-melori-border bg-melori-elevated"
                  }`}
                >
                  <span>{emoji}</span>
                  {g.count > 1 && <span className="text-[10px] text-melori-muted">{g.count}</span>}
                </button>
              ))}
            </div>
          )}

          {seen && (
            <span className="mt-0.5 text-[10px] text-melori-muted" aria-live="polite">
              Seen
            </span>
          )}

          {/* Reaction picker (long-press on touch, or the smile button). */}
          {picking && canReact && (
            <div
              className={`absolute bottom-full z-20 mb-1 flex gap-1 rounded-full border border-melori-border bg-melori-elevated px-2 py-1 shadow-xl ${
                isMe ? "right-0" : "left-0"
              }`}
              onMouseLeave={() => setPicking(false)}
            >
              {REACTION_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onReact!(message.id, e);
                    setPicking(false);
                  }}
                  className="rounded-full p-1 text-lg leading-none transition hover:scale-125"
                  aria-label={`React ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Hover actions: react (everyone) and delete (own messages). */}
        <div className="mb-1 flex items-center">
          {canReact && !confirming && (
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              aria-label="React to message"
              title="React"
              className="rounded-full p-1 text-melori-muted opacity-0 transition-opacity hover:text-melori-text focus:opacity-100 group-hover:opacity-100"
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
          )}
          {isMe && !isDeleted && !status && onDelete && (
            confirming ? (
              <span className="flex items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => {
                    onDelete(message.id);
                    setConfirming(false);
                  }}
                  className="rounded-full bg-red-600 px-2 py-0.5 font-semibold text-white hover:bg-red-500"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-full bg-melori-elevated px-2 py-0.5 text-melori-muted hover:text-melori-text"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label="Delete message"
                title="Delete message"
                className="rounded-full p-1 text-melori-muted opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
