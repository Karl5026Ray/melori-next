"use client";

import { type ReactNode } from "react";

/**
 * Cinema's rendering boundary.
 *
 * A Cinema room is a podcast-style watch party in one non-scrolling viewport,
 * kept separate from Spaces' speaker grid so that layout cannot leak in here.
 * Since the Clubhouse-style layout (13 Oct 2026) it reads top to bottom as:
 *
 *   1. `screen`   — the shared screen, a clamped share of the viewport height
 *   2. `seats`    — the host and two guests: three big voice circles in a row
 *                   (88px on a phone, 112px from sm). They never scroll.
 *   3. the lower region, one row that takes the leftover height:
 *        - `chat`     (left, flex-1) — the newest few messages floating over
 *          the bottom, fading toward the top, with no box. Tapping them opens
 *          the full chat log as a bottom sheet.
 *        - `audience` (right, ~72px) — the listeners' rail: "N watching" and
 *          a vertical list of 44px voice circles that scrolls in its own
 *          column, raised hands first, then people the host follows.
 *
 * The message composer is not part of the canvas; it sits in the bottom dock
 * with "Leave quietly" (CinemaRoomScreen).
 *
 * Before this the room stacked four bands (screen, small seats, a one-line
 * listener strip with a "+N" chip, and a boxed chat panel). The seats were too
 * small to read a face in and most of the room hid behind "+N"; moving the
 * listeners to a scrolling rail let the seats grow without costing anyone.
 */
export function CinemaRoomCanvas({
  screen,
  seats,
  audience,
  chat,
}: {
  screen: ReactNode;
  seats?: ReactNode;
  audience: ReactNode;
  chat?: ReactNode;
}) {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden sm:gap-2"
      data-testid="cinema-room-canvas"
      aria-label="Cinema room"
    >
      {/* Never below the floor (the film is why people came), and on a phone
          a bit over a quarter of the height, so the seats and the lower region
          still fit below it on a 664px-tall iPhone viewport. */}
      <div
        className="flex h-[clamp(9.5rem,28dvh,24rem)] shrink-0"
        data-testid="cinema-screen-band"
      >
        {screen}
      </div>
      {seats}
      <div
        className="flex min-h-0 flex-1 items-stretch gap-2"
        data-testid="cinema-lower-region"
      >
        {chat}
        {audience}
      </div>
    </section>
  );
}

export default CinemaRoomCanvas;
