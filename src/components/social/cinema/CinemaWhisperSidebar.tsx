"use client";

/**
* SCAFFOLD / DRAFT component introduced alongside the "Cinema Room" design
* concept (private tap-to-whisper sidebar). Presentational only:
*
* - No realtime transport is wired up here. In production this needs a
*   private channel per (roomId, participantA, participantB) pair -- the
*   existing Messages/DM system may be reusable for that rather than
*   building a new one; that decision needs an engineer familiar with the
*   Messages data model to make.
* - Muting the main room while whispering (per the product decision:
*   "whisper_scope: muted from main room while whispering") is NOT
*   implemented here -- that has to happen wherever the room's LiveKit
*   audio publish state lives (see roomMediaPolicy.ts), not in this
*   component.
* - Written with React.createElement instead of JSX syntax.
* - This file has not been run through the project's type checker, linter,
*   or test suite.
*/

import { createElement as h, useState, type FormEvent } from "react";

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
  messages: readonly WhisperMessage[];
  onSend: (body: string) => void;
  onClose: () => void;
}

export function CinemaWhisperSidebar(props: CinemaWhisperSidebarProps) {
  const { withDisplayName, messages, onSend, onClose } = props;
  const [draft, setDraft] = useState("");

function handleSubmit(e: FormEvent) {
  e.preventDefault();
  const body = draft.trim();
  if (!body) return;
  onSend(body);
  setDraft("");
}

return h(
  "aside",
  {
    "aria-label": "Whisper with " + withDisplayName,
    className: "flex h-full w-full max-w-sm flex-col border-l border-white/10 bg-black/95 text-white",
  },
  h(
    "header",
    { className: "flex items-center justify-between border-b border-white/10 px-4 py-3" },
    h(
      "div",
      null,
      h("p", { className: "text-xs uppercase tracking-wide text-amber-400" }, "Whisper"),
      h("p", { className: "text-sm font-medium" }, withDisplayName),
      ),
    h(
      "button",
      {
        type: "button",
        onClick: onClose,
        "aria-label": "Close whisper",
        className: "rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white",
      },
      "\u2715",
      ),
    ),
  h(
    "p",
    { className: "border-b border-white/10 px-4 py-2 text-xs text-white/40" },
    "Only " + withDisplayName + " can see this. You are muted from the main room while whispering.",
    ),
  h(
    "div",
    { className: "flex-1 space-y-2 overflow-y-auto px-4 py-3" },
    messages.length === 0
    ? h("p", { className: "text-sm text-white/40" }, "Say hi to " + withDisplayName + ".")
    : messages.map((m) =>
      h(
        "div",
        { key: m.id, className: "max-w-[85%] rounded-2xl bg-white/10 px-3 py-2 text-sm" },
        h("p", { className: "mb-0.5 text-[11px] text-amber-400" }, m.fromDisplayName),
        h("p", null, m.body),
        ),
                   ),
    ),
  h(
    "form",
    { onSubmit: handleSubmit, className: "flex items-center gap-2 border-t border-white/10 p-3" },
    h("input", {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
      placeholder: "Whisper to " + withDisplayName + "...",
      className: "flex-1 rounded-full bg-white/10 px-4 py-2 text-sm outline-none placeholder:text-white/30",
    }),
    h(
      "button",
      {
        type: "submit",
        disabled: !draft.trim(),
        className: "rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-40",
      },
      "Send",
      ),
    ),
  );
}
