"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

export interface WhisperMessage {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  body: string;
  sentAt: string;
}

export interface CinemaWhisperSidebarProps {
  withUserId: string;
  withDisplayName: string;
  selfId: string | null;
  messages: readonly WhisperMessage[];
  onSend: (body: string) => void;
  onClose: () => void;
  opening?: boolean;
  sending?: boolean;
  error?: string | null;
}

/** Matches the server-side cap in the messages route. */
const MAX_WHISPER_CHARS = 2000;

/**
 * A private side conversation with one person in the room.
 *
 * The copy here is deliberate. A whisper is carried on the ordinary
 * direct-message system, so it is a real, permanent message: it stays in both
 * inboxes after the room ends and can trigger the usual notification email.
 * Telling someone it is private but not telling them it is permanent would be
 * the kind of half-truth that costs trust the first time somebody notices.
 */
export function CinemaWhisperSidebar({
  withDisplayName,
  selfId,
  messages,
  onSend,
  onClose,
  opening = false,
  sending = false,
  error = null,
}: CinemaWhisperSidebarProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    onSend(body);
    setDraft("");
  }

  return (
    <aside
      aria-label={`Whisper with ${withDisplayName}`}
      className="flex h-full w-full max-w-sm flex-col border-l border-white/10 bg-black/95 text-white"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-amber-400">
            Whisper
          </p>
          <p className="text-sm font-medium">{withDisplayName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close whisper"
          className="rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white"
        >
          {"✕"}
        </button>
      </header>

      <p className="border-b border-white/10 px-4 py-2 text-xs text-white/40">
        Only {withDisplayName} can see this. Whispers are real messages — they
        stay in your Messages after the room ends.
      </p>

      {error && (
        <p
          role="alert"
          className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300"
        >
          {error}
        </p>
      )}

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {opening ? (
          <p className="text-sm text-white/40">Opening…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-white/40">Say hi to {withDisplayName}.</p>
        ) : (
          messages.map((m) => {
            const mine = selfId !== null && m.fromUserId === selfId;
            return (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  mine ? "ml-auto bg-amber-400/20" : "bg-white/10"
                }`}
              >
                <p className="mb-0.5 text-[11px] text-amber-400">
                  {m.fromDisplayName}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-white/10 p-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_WHISPER_CHARS}
          disabled={opening}
          placeholder={`Whisper to ${withDisplayName}…`}
          aria-label={`Whisper to ${withDisplayName}`}
          className="flex-1 rounded-full bg-white/10 px-4 py-2 text-sm outline-none placeholder:text-white/30 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending || opening}
          className="rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </aside>
  );
}
