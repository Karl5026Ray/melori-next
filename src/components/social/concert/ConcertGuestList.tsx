"use client";

import { concertGuestBadge, type ConcertGuestBadge } from "@/lib/concertStage";

export interface ConcertGuest {
  userId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  badge: string | null;
  isCompetitor: boolean;
  joinedAt: string | null;
  coinsGifted: number;
}

const BADGE_STYLE: Record<ConcertGuestBadge, string> = {
  VIP: "bg-[#f5e56b]/15 text-[#f5e56b]",
  GIFTER: "bg-[#ff4d6d]/15 text-[#ff8fa3]",
  NEW: "bg-white/10 text-white/50",
};

/**
 * The audience roster beside the chat. Everyone here is audience-only: this
 * list has no promote control, because the Concert stage is fixed at the two
 * competitor identities recorded on the battle.
 */
export function ConcertGuestList({
  guests,
  now,
}: {
  guests: readonly ConcertGuest[];
  /** Passed in so the NEW window is deterministic under test. */
  now: number;
}) {
  return (
    <section
      className="flex min-h-0 w-[35%] shrink-0 flex-col rounded-xl border border-white/[0.06] bg-[#16161c] p-1.5"
      data-testid="concert-guest-list"
      aria-label="Audience"
    >
      <p className="mb-1 flex shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-white/40">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#00d966]" aria-hidden />
        <span className="truncate">{guests.length} live</span>
      </p>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {guests.map((guest) => {
          const badge = concertGuestBadge({
            isCompetitor: guest.isCompetitor,
            verified: guest.badge === "vip",
            coinsGifted: guest.coinsGifted,
            joinedAtMs: guest.joinedAt ? Date.parse(guest.joinedAt) : null,
            nowMs: now,
          });
          return (
            <li
              key={guest.userId}
              className="flex items-center gap-1"
              data-testid="concert-guest"
              data-badge={badge ?? ""}
            >
              {guest.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={guest.avatarUrl}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full bg-white/10" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate text-[10px] text-white/70">
                @{guest.handle}
              </span>
              {badge ? (
                <span
                  className={`shrink-0 rounded px-1 text-[7px] font-extrabold tracking-wide ${BADGE_STYLE[badge]}`}
                >
                  {badge}
                </span>
              ) : null}
            </li>
          );
        })}
        {guests.length === 0 ? (
          <li className="text-[10px] text-white/30">Waiting for the crowd.</li>
        ) : null}
      </ul>
    </section>
  );
}
