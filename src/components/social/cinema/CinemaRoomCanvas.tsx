"use client";

import { type ReactNode } from "react";

/**
 * Cinema's rendering boundary.
 *
 * This is intentionally not a generic Room/Stage wrapper: a Cinema room is a
 * compact live-video watch party with a single media canvas. Its media screen,
 * fixed video seats, and voice audience are kept in one non-scrolling viewport
 * so Spaces' speaker-grid behavior cannot leak back into Cinema.
 *
 * Reading top to bottom, a Cinema room is three bands:
 *
 *   1. `screen`   — the big shared screen, which takes all leftover height
 *   2. `seats`    — the three live-video spots (host + two guests)
 *   3. `audience` — the voice-only listeners as rows of volume-ringed circles
 *
 * The seats used to be overlaid on top of the screen, which meant three small
 * tiles sat on the movie and covered part of it. They are their own band now, so
 * the shared screen is never obscured and the faces are large enough to read.
 */
export function CinemaRoomCanvas({
  screen,
  seats,
  audience,
}: {
  screen: ReactNode;
  seats?: ReactNode;
  audience: ReactNode;
}) {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
      data-testid="cinema-room-canvas"
      aria-label="Cinema live video room"
    >
      {/* The shared screen takes every pixel the seats and the voice rows do
          not need, and never less than this floor: it is the reason people are
          here, so it must not be squeezed to a sliver by a full audience. */}
      <div className="flex min-h-[10rem] flex-1 sm:min-h-[13rem]">{screen}</div>
      {seats}
      {audience}
    </section>
  );
}

export default CinemaRoomCanvas;
