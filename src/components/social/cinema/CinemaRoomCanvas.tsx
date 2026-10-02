"use client";

import { type ReactNode } from "react";

/**
 * Cinema's rendering boundary.
 *
 * A Cinema room is a podcast-style watch party in one non-scrolling viewport,
 * kept separate from Spaces' speaker grid so that layout cannot leak in here.
 * Reading top to bottom it has four bands:
 *
 *   1. `screen`   — the shared screen, a fixed share of the viewport height
 *   2. `seats`    — three audio seats: the host and two guests
 *   3. `audience` — the listeners, one compact strip of voice circles
 *   4. `chat`     — the persistent room chat, which takes the leftover height
 *
 * The chat band is new (1 Oct 2026). The screen used to take all leftover
 * height and the bottom of the room sat empty while comments faded off the
 * video after eight seconds. The screen now gets a clamped share of the height,
 * so a tall phone gives the extra room to the conversation rather than to
 * black bars around a 16:9 picture.
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
          a bit over a quarter of the height, so the seats, the listeners and a
          readable chat all fit below it on a 664px-tall iPhone viewport. */}
      <div
        className="flex h-[clamp(9.5rem,28dvh,24rem)] shrink-0"
        data-testid="cinema-screen-band"
      >
        {screen}
      </div>
      {seats}
      {audience}
      {chat}
    </section>
  );
}

export default CinemaRoomCanvas;
