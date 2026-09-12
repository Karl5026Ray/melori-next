"use client";

/**
* SCAFFOLD / DRAFT component introduced alongside the "Cinema Room" design
* concept. Presentational only -- it renders CINEMA_TALK_MODES from
* cinemaTalkModes.ts and calls back on selection, but does not persist the
* chosen mode anywhere. Wiring this up for real needs:
*
*   1. A place to store the room's current talk mode (e.g. a column on the
*      `spaces` row, alongside room_format -- see cinema.ts / migrations
*      in supabase/migrations for the existing pattern).
*   2. A realtime broadcast of that value to everyone in the room.
*   3. Enforcement in the actual media/publish layer (roomMediaPolicy.ts),
*      not just in this UI -- this component only decides what the picker
*      shows, never who can actually publish audio.
*
* Written with React.createElement instead of JSX syntax.
* This file has not been run through the project's type checker, linter,
* or test suite.
*/

import { createElement as h, useState } from "react";
import {
  CINEMA_TALK_MODES,
  type CinemaTalkMode,
} from "@/lib/cinemaTalkModes";

export interface CinemaTalkModeSwitcherProps {
  mode: CinemaTalkMode;
  isHost: boolean;
  onChange: (mode: CinemaTalkMode) => void;
}

/**
* Host-only control for switching a live Cinema room between Silent,
* Intermission, and Director's Commentary. Non-hosts see the current mode
* as a read-only pill instead of a picker.
*/
export function CinemaTalkModeSwitcher(props: CinemaTalkModeSwitcherProps) {
  const { mode, isHost, onChange } = props;
  const [open, setOpen] = useState(false);
  const current = CINEMA_TALK_MODES.find((m) => m.value === mode) ?? CINEMA_TALK_MODES[0];

if (!isHost) {
  return h(
    "div",
    {
      className:
        "flex items-center gap-2 rounded-full border border-amber-400/40 bg-black/60 px-3 py-1 text-xs text-amber-300",
    },
    current.label,
    );
}

return h(
  "div",
  { className: "relative inline-block text-sm" },
  h(
    "button",
    {
      type: "button",
      onClick: () => setOpen((v) => !v),
      className:
        "flex items-center gap-2 rounded-full border border-amber-400/60 bg-black/60 px-3 py-1.5 text-amber-300 hover:bg-black/80",
    },
    current.label,
    h("span", { className: "text-amber-400/70" }, "\u203a"),
    ),
  open
  ? h(
    "ul",
    {
      className:
        "absolute z-10 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-xl",
    },
    CINEMA_TALK_MODES.map((m) =>
      h(
        "li",
        { key: m.value },
        h(
          "button",
          {
            type: "button",
            onClick: () => {
              onChange(m.value);
              setOpen(false);
            },
            className:
              "block w-full px-4 py-2 text-left hover:bg-white/10 " +
              (m.value === mode ? "text-amber-400" : "text-white"),
          },
          h("span", { className: "block font-medium" }, m.label),
          h("span", { className: "block text-xs text-white/40" }, m.description),
          ),
        ),
                          ),
    )
  : null,
  );
}
