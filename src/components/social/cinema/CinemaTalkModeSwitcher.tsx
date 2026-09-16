"use client";

import { useEffect, useRef, useState } from "react";
import {
  CINEMA_TALK_MODES,
  getTalkModeMeta,
  type CinemaTalkMode,
} from "@/lib/cinemaTalkModes";

export interface CinemaTalkModeSwitcherProps {
  mode: CinemaTalkMode;
  /** Host or moderator. Everyone else sees a read-only pill. */
  canControl: boolean;
  onChange: (mode: CinemaTalkMode) => void;
  /** A change is in flight; the control stays interactive but shows it. */
  pending?: boolean;
}

/**
 * The room's talk mode, and — for a host or moderator — the control that
 * changes it.
 *
 * This is a label and a picker, nothing more. Whether anyone's microphone is
 * actually live is decided server-side in roomMediaPolicy.ts and applied to
 * LiveKit by the /talk-mode route. Non-controllers still see the mode, because
 * "why can't I talk" should have a visible answer in the room.
 */
export function CinemaTalkModeSwitcher({
  mode,
  canControl,
  onChange,
  pending = false,
}: CinemaTalkModeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = getTalkModeMeta(mode);

  // Close on outside click and on Escape, so the menu can't be left hanging
  // over a live room.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!canControl) {
    return (
      <div
        className="flex items-center gap-2 rounded-full border border-amber-400/40 bg-black/60 px-3 py-1 text-xs text-amber-300"
        title={current.description}
      >
        {current.label}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-block text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Talk mode: ${current.label}. Change it.`}
        className="flex items-center gap-2 rounded-full border border-amber-400/60 bg-black/60 px-3 py-1.5 text-amber-300 hover:bg-black/80 disabled:opacity-60"
        disabled={pending}
      >
        {current.label}
        <span aria-hidden className="text-amber-400/70">
          {pending ? "…" : "›"}
        </span>
      </button>

      {open && (
        <ul
          role="menu"
          className="absolute z-10 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-xl"
        >
          {CINEMA_TALK_MODES.map((m) => (
            <li key={m.value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={m.value === mode}
                onClick={() => {
                  onChange(m.value);
                  setOpen(false);
                }}
                className={`block w-full px-4 py-2 text-left hover:bg-white/10 ${
                  m.value === mode ? "text-amber-400" : "text-white"
                }`}
              >
                <span className="block font-medium">{m.label}</span>
                <span className="block text-xs text-white/40">
                  {m.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
