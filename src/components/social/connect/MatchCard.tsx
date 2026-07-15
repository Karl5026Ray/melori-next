"use client";

import { Heart, X, BadgeCheck, MessageCircle } from "lucide-react";
import { HarmonyBadge } from "./HarmonyBadge";
import type { ConnectCard } from "./types";

// Full-bleed daily-match card. Photo dominates; name/age + Harmony badge and one
// prompt preview sit over the image; the primary Like/Pass actions live in the
// bottom-center thumb zone (per the mobile-first spec).
export function MatchCard({
  card,
  onLike,
  onPass,
  onSuperLike,
  busy = false,
}: {
  card: ConnectCard;
  onLike: () => void;
  onPass: () => void;
  onSuperLike?: () => void;
  busy?: boolean;
}) {
  const name = card.display_name || card.username || "Member";
  const photo = card.photo_url || card.avatar_url;

  return (
    <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-melori-border bg-melori-surface shadow-2xl">
      <div className="relative aspect-[3/4] w-full bg-melori-elevated">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-6xl font-bold text-melori-muted">
            {name.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Gradient scrim for legibility */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

        {/* Harmony badge, top-left */}
        <div className="absolute left-4 top-4">
          <HarmonyBadge harmony={card.harmony} />
        </div>

        {/* Identity + prompt, bottom */}
        <div className="absolute inset-x-0 bottom-0 p-5">
          <div className="flex items-center gap-2">
            <h3 className="text-2xl font-bold text-white">
              {name}
              {card.age != null && (
                <span className="ml-2 font-medium text-white/80">{card.age}</span>
              )}
            </h3>
            {card.verified && <BadgeCheck className="h-5 w-5 text-melori-accent" />}
          </div>
          {card.bio_override && (
            <p className="mt-1 line-clamp-2 text-sm text-white/85">{card.bio_override}</p>
          )}
          {card.prompt_preview && (
            <div className="mt-3 rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
              <p className="text-[11px] uppercase tracking-wide text-white/60">
                {card.prompt_preview.text}
              </p>
              <p className="mt-0.5 text-sm font-medium text-white">
                {card.prompt_preview.answer}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Thumb-zone actions */}
      <div className="flex items-center justify-center gap-6 p-5">
        <button
          type="button"
          onClick={onPass}
          disabled={busy}
          aria-label="Pass"
          className="flex h-14 w-14 items-center justify-center rounded-full border border-melori-border bg-melori-elevated text-melori-muted transition hover:text-melori-danger disabled:opacity-50"
        >
          <X className="h-6 w-6" />
        </button>
        {onSuperLike && (
          <button
            type="button"
            onClick={onSuperLike}
            disabled={busy}
            aria-label="Super like"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-melori-accent/50 bg-melori-elevated text-melori-accent transition hover:bg-melori-accent/10 disabled:opacity-50"
          >
            <MessageCircle className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          onClick={onLike}
          disabled={busy}
          aria-label="Like"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-melori-purple to-melori-pink text-white shadow-lg transition hover:scale-105 disabled:opacity-50"
        >
          <Heart className="h-7 w-7" fill="currentColor" />
        </button>
      </div>
    </div>
  );
}
