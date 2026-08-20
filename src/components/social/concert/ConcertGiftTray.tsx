"use client";

import { Loader2 } from "lucide-react";
import {
  CONCERT_INSTRUMENT_GIFTS,
  type ConcertSide,
  type ConcertInstrumentGift,
} from "@/lib/concertStage";
import type { GiftCatalogItem } from "@/lib/gifting";

export interface ConcertTrayGift {
  instrument: ConcertInstrumentGift;
  /** The server catalog row. Absent means the migration has not been applied. */
  gift: GiftCatalogItem | null;
}

/**
 * Resolve the tray against the server's gift catalog.
 *
 * The price shown is ALWAYS the server's price_coins, never the local
 * expectedPriceCoins constant — that constant exists only so a contract test
 * can catch the catalog drifting away from the design. An instrument with no
 * catalog row renders disabled rather than sending an unpriced gift.
 */
export function resolveConcertTray(
  catalog: readonly GiftCatalogItem[],
): ConcertTrayGift[] {
  return CONCERT_INSTRUMENT_GIFTS.map((instrument) => ({
    instrument,
    gift: catalog.find((entry) => entry.slug === instrument.slug) ?? null,
  }));
}

const TARGET_STYLE: Record<ConcertSide, { on: string; label: string }> = {
  left: { on: "border-[#ff4d6d]/60 bg-[#ff4d6d]/15 text-[#ff8fa3]", label: "Gift left" },
  right: { on: "border-[#4dabff]/60 bg-[#4dabff]/15 text-[#8fd0ff]", label: "Gift right" },
};

export function ConcertGiftTray({
  tray,
  target,
  walletCoins,
  pendingSlug,
  disabledReason,
  showTargetPicker,
  onTargetChange,
  onSend,
}: {
  tray: readonly ConcertTrayGift[];
  /** Which competitor the gift is aimed at; null until the viewer picks one. */
  target: ConcertSide | null;
  walletCoins: number | null;
  pendingSlug: string | null;
  disabledReason: string | null;
  /** Competitors cannot gift, so they get no picker. */
  showTargetPicker: boolean;
  onTargetChange: (side: ConcertSide) => void;
  onSend: (entry: ConcertTrayGift) => void;
}) {
  return (
    <section className="shrink-0 border-t border-white/[0.06] bg-[#111116] px-2 py-1.5" aria-label="Send an instrument">
      {/* The stage picker lives in this header rather than in its own row: a
          separate row cost ~30px of the video budget on a phone. */}
      <div className="mb-1 flex items-center justify-between gap-2">
        {showTargetPicker ? (
          <div className="flex min-w-0 gap-1" role="group" aria-label="Choose who to gift">
            {(["left", "right"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => onTargetChange(side)}
                aria-pressed={target === side}
                data-testid="concert-gift-target"
                data-side={side}
                className={`rounded-full border px-2 py-[3px] text-[9px] font-extrabold uppercase tracking-[0.08em] transition ${
                  target === side
                    ? TARGET_STYLE[side].on
                    : "border-white/[0.07] bg-white/[0.03] text-white/35"
                }`}
              >
                {TARGET_STYLE[side].label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
            You are performing
          </p>
        )}
        <p className="shrink-0 text-[10px] font-bold tabular-nums text-[#f5e56b]">
          {walletCoins === null ? "—" : `${walletCoins.toLocaleString()} coins`}
        </p>
      </div>

      <ul
        className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="concert-gift-tray"
      >
        {tray.map((entry) => {
          const price = entry.gift?.price_coins ?? entry.instrument.expectedPriceCoins;
          const unavailable = !entry.gift || !target || Boolean(disabledReason);
          const pending = pendingSlug === entry.instrument.slug;
          const tooPoor = walletCoins !== null && walletCoins < price;
          return (
            <li key={entry.instrument.slug} className="shrink-0">
              <button
                type="button"
                onClick={() => onSend(entry)}
                disabled={unavailable || pending || tooPoor}
                aria-label={`Send ${entry.instrument.label} for ${price} coins`}
                data-testid="concert-gift-option"
                data-slug={entry.instrument.slug}
                data-price={price}
                className="relative flex w-[60px] flex-col items-center gap-0.5 rounded-xl border border-white/[0.07] bg-[#1c1c24] px-1 pb-1 pt-3 transition active:scale-95 disabled:opacity-40"
              >
                {/* Corner tag rather than an overlay: the instrument emoji sits
                    centred below it, so the card gets top padding instead of
                    letting the badge cover the artwork. */}
                <span className="absolute left-0 right-0 top-0.5 text-center text-[7px] font-extrabold tracking-[0.12em] text-[#f5e56b]/70">
                  GLB
                </span>
                <span className="text-xl leading-none" aria-hidden>
                  {pending ? (
                    <Loader2 className="h-5 w-5 animate-spin text-white/60" />
                  ) : (
                    entry.instrument.emoji
                  )}
                </span>
                <span className="w-full truncate text-center text-[9px] font-semibold text-white/70">
                  {entry.instrument.label}
                </span>
                <span className="text-[9px] font-extrabold tabular-nums text-[#f5e56b]">
                  {price}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {disabledReason ? (
        <p className="mt-1 text-[10px] text-white/40" data-testid="concert-gift-disabled">
          {disabledReason}
        </p>
      ) : null}
    </section>
  );
}
