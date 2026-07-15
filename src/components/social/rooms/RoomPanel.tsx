"use client";

// RoomPanel — the ONE shared right-side panel used by every live room type
// (MM Spaces audio, MM Faces video, and any future room). It holds the room
// CONTROLS at the top (mute / camera / leave / raise-hand / host-mod actions —
// passed in by each room via the `controls` slot) and the shared RoomChat feed
// below.
//
// Responsive behaviour
// --------------------
//   • Desktop (>= md): a fixed-width column (default 340px) that the parent
//     places to the right of the stage in a flex/grid layout. Controls sit in a
//     sticky header; chat fills the remaining height and scrolls internally.
//   • Mobile (< md): a bottom sheet that slides up over the stage. A drag handle
//     + backdrop let the user dismiss it; `open`/`onClose` are controlled by the
//     parent (usually a "Chat" button in the mobile action bar). The compact
//     controls bar sits above the chat so mute/leave stay reachable one-handed.
//
// The sheet uses the existing `@keyframes sheetUp` from globals.css. Chat itself
// handles auto-scroll, the "N new messages" pill, grouping and the mobile
// keyboard (visualViewport) — RoomPanel only owns layout + the controls slot.

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import RoomChat, { type RoomSystemMessage } from "./RoomChat";

export default function RoomPanel({
  spaceId,
  controls,
  systemMessages = [],
  accent = "purple",
  title = "Room",
  widthClass = "md:w-[340px]",
  open = false,
  onClose,
  className = "",
}: {
  spaceId: string;
  controls?: ReactNode;
  systemMessages?: RoomSystemMessage[];
  accent?: "purple" | "orange";
  title?: string;
  // Tailwind width utility for the desktop column.
  widthClass?: string;
  // Mobile bottom-sheet visibility (ignored on desktop, where the panel is
  // always shown as a column).
  open?: boolean;
  onClose?: () => void;
  className?: string;
}) {
  const border = accent === "orange" ? "border-brand-border" : "border-melori-border";
  const surface = accent === "orange" ? "bg-brand-surface" : "bg-melori-elevated";

  // Lock body scroll while the mobile sheet is open so the page behind doesn't
  // scroll under the sheet.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const inner = (
    <div className="flex min-h-0 flex-1 flex-col">
      {controls && (
        <div
          className={`shrink-0 border-b ${border}/60 px-3 py-2`}
        >
          {controls}
        </div>
      )}
      <RoomChat
        spaceId={spaceId}
        systemMessages={systemMessages}
        accent={accent}
        className="flex-1"
      />
    </div>
  );

  return (
    <>
      {/* Desktop: fixed-width column. Hidden on mobile (sheet takes over). */}
      <aside
        className={`hidden md:flex ${widthClass} min-h-0 shrink-0 flex-col border-l ${border} ${surface}/40 ${className}`}
      >
        {inner}
      </aside>

      {/* Mobile: bottom sheet. */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close panel"
            onClick={onClose}
            className="absolute inset-0 bg-black/50"
          />
          <div
            className={`absolute inset-x-0 bottom-0 flex h-[82vh] flex-col rounded-t-2xl border-t ${border} ${surface} shadow-2xl`}
            style={{ animation: "sheetUp 0.22s ease-out" }}
          >
            <div className="relative flex items-center justify-center py-2">
              <span className="h-1 w-10 rounded-full bg-white/25" />
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="absolute right-2 top-1.5 rounded-full p-1.5 text-melori-muted hover:text-melori-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-melori-muted">
              {title}
            </p>
            {inner}
          </div>
        </div>
      )}
    </>
  );
}
