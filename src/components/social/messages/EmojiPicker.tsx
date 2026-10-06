"use client";

import { useEffect, useRef } from "react";

// A small, dependency-free emoji picker for the message composer. Covers the
// emoji people actually use in chat; no search, no skin tones — on purpose,
// to keep the bundle light.
const EMOJI = [
  "😀", "😂", "🤣", "😊", "😍", "🥰", "😘", "😎",
  "🤔", "😮", "😢", "😭", "😡", "🥺", "😴", "🙄",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "✌️", "🤝",
  "❤️", "🔥", "✨", "💯", "🎉", "🎶", "🎵", "🎤",
  "🎧", "🎸", "🎹", "🥁", "🎷", "🎺", "📸", "🎬",
  "👀", "💜", "💙", "🖤", "⭐", "🌙", "☀️", "🌹",
];

export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick an emoji"
      className="absolute bottom-full right-0 z-30 mb-2 w-72 rounded-2xl border border-melori-border bg-melori-elevated p-2 shadow-2xl"
    >
      <div className="grid grid-cols-8 gap-1">
        {EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className="rounded-lg p-1 text-xl leading-none transition hover:bg-white/10"
            aria-label={`Insert ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
