"use client";

// CinemaAudience — the "WATCHING · N" block beneath the stage.
//
// Three columns of circular avatars with the username underneath, and a green
// presence dot on anyone currently unmuted and speaking. Mirrors the mockup,
// which reads as a room of faces rather than the dense small-avatar grid the
// talk-room format uses.
//
// The count in the header is the audience length passed in by the room page,
// which already excludes people who have left (left_at is set).

import { SpaceParticipant } from "@/types/social";
import { useEffect, useRef, useState } from "react";
import { ChevronUp, X } from "lucide-react";

interface CinemaAudienceProps {
  audience: SpaceParticipant[];
  onReactToParticipant?: (participant: SpaceParticipant) => void;
  reactionBursts?: Record<string, string[]>;
}

export function CinemaAudience({
  audience,
  onReactToParticipant,
  reactionBursts,
}: CinemaAudienceProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rosterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(() => rosterRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <section className="min-h-0" data-testid="cinema-audience-panel">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/40 transition hover:text-white/70"
        data-testid="cinema-audience-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>Watching · {audience.length}</span>
        <ChevronUp className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Cinema audience"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[70dvh] w-full max-w-lg flex-col rounded-t-3xl border border-cinema-border bg-cinema-void p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl md:rounded-3xl md:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Audience</p>
                <p className="mt-0.5 text-xs text-white/40">
                  {audience.length} watching
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
                aria-label="Close audience roster"
                data-testid="cinema-audience-close"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div
              ref={rosterRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
              data-testid="cinema-audience-roster"
              tabIndex={0}
              aria-label="Cinema audience roster"
            >
        {audience.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/25">
            No one in the audience yet.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-x-4 gap-y-5 pb-3">
            {audience.map((participant) => {
            const user = participant.user;
            const muted = participant.is_muted || participant.host_muted;
            const isLive = participant.is_speaking && !muted;
            const targetId = user?.id ?? participant.user_id;
            const bursts = reactionBursts?.[targetId] ?? [];
            const name = user?.username || user?.display_name || "guest";

            return (
              <button
                key={participant.id}
                type="button"
                onClick={() => onReactToParticipant?.(participant)}
                aria-label={`React to ${name}`}
                className="group flex flex-col items-center gap-2"
              >
                <div className="relative">
                  {bursts.length > 0 && (
                    <div className="pointer-events-none absolute inset-x-0 -top-3 z-20 flex justify-center gap-1">
                      {bursts.map((r) => (
                        <span
                          key={r}
                          className="animate-slide-up text-base leading-none"
                        >
                          {r.slice(r.indexOf(":") + 1) || "❤️"}
                        </span>
                      ))}
                    </div>
                  )}

                  {user?.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-14 w-14 rounded-full border border-white/15 object-cover transition group-hover:border-cinema-gold/50"
                    />
                  ) : (
                    <div className="grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-white/[0.03] transition group-hover:border-cinema-gold/50">
                      <span className="text-sm font-medium text-white/40">
                        {name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}

                  {isLive && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-cinema-void bg-melori-success"
                      aria-label="Speaking"
                    >
                      <span className="h-1 w-1 rounded-full bg-cinema-void" />
                    </span>
                  )}
                </div>

                <span
                  className={`max-w-full truncate text-[11px] ${
                    isLive ? "text-white/80" : "text-white/40"
                  }`}
                >
                  {name}
                </span>
              </button>
            );
            })}
          </div>
        )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default CinemaAudience;
