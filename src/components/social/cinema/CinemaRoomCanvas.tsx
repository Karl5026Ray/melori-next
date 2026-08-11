"use client";

import { type ReactNode } from "react";

/**
 * Cinema's rendering boundary.
 *
 * This is intentionally not a generic Room/Stage wrapper: a Cinema room is a
 * compact live-video watch party with a single media canvas. Its media screen,
 * fixed video seats, and horizontal audience are kept in one non-scrolling
 * viewport so Spaces' speaker-grid behavior cannot leak back into Cinema.
 */
export function CinemaRoomCanvas({
  screen,
  audience,
}: {
  screen: ReactNode;
  audience: ReactNode;
}) {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
      data-testid="cinema-room-canvas"
      aria-label="Cinema live video room"
    >
      <div className="flex min-h-0 flex-1">{screen}</div>
      {audience}
    </section>
  );
}

export default CinemaRoomCanvas;
