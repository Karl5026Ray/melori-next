"use client";

import { useEffect, useRef } from "react";
import { BadgeCheck, VideoOff } from "lucide-react";
import {
  CONCERT_FLOAT_DURATION_MS,
  type ConcertFloatItem,
  type ConcertSide,
} from "@/lib/concertStage";

export interface ConcertCompetitorView {
  side: ConcertSide;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  /** An attached <video> handed back by livekitVideoClient, if publishing. */
  videoElement: HTMLVideoElement | null;
  /** Mirror the local self-preview only; never the published track. */
  mirrored: boolean;
  isLive: boolean;
  placeholder: string;
}

const SIDE_ACCENT: Record<ConcertSide, string> = {
  left: "#ff4d6d",
  right: "#4dabff",
};

/**
 * One competitor tile. The LiveKit <video> element is OWNED by the video client
 * and adopted into this container by ref, which is why the element is appended
 * rather than rendered as JSX: React must not recreate or reparent a node whose
 * MediaStream is attached elsewhere.
 */
function CompetitorTile({
  competitor,
  floats,
}: {
  competitor: ConcertCompetitorView;
  floats: readonly ConcertFloatItem[];
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const element = competitor.videoElement;
    if (!mount) return;
    if (!element) {
      mount.replaceChildren();
      return;
    }
    element.className = "h-full w-full object-cover";
    element.style.transform = competitor.mirrored ? "scaleX(-1)" : "";
    element.muted = element.muted || false;
    element.playsInline = true;
    if (element.parentElement !== mount) mount.replaceChildren(element);
    return () => {
      if (element.parentElement === mount) mount.replaceChildren();
    };
  }, [competitor.videoElement, competitor.mirrored]);

  return (
    <div
      className="relative flex-1 overflow-hidden rounded-xl border border-white/[0.07] bg-black"
      data-testid="concert-competitor"
      data-side={competitor.side}
      data-has-video={competitor.videoElement ? "true" : "false"}
    >
      <div ref={mountRef} className="absolute inset-0" />

      {competitor.videoElement ? null : (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-white/[0.04] to-transparent px-2 text-center">
          {competitor.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={competitor.avatarUrl}
              alt=""
              className="h-12 w-12 rounded-full object-cover opacity-70"
            />
          ) : (
            <VideoOff className="h-6 w-6 text-white/25" aria-hidden />
          )}
          <p className="absolute bottom-8 left-0 right-0 px-2 text-[10px] leading-tight text-white/40">
            {competitor.placeholder}
          </p>
        </div>
      )}

      <span
        className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-[0.08em]"
        style={{ color: SIDE_ACCENT[competitor.side] }}
        data-testid="concert-competitor-live"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${competitor.isLive ? "animate-pulse" : "opacity-40"}`}
          style={{ background: SIDE_ACCENT[competitor.side] }}
          aria-hidden
        />
        {competitor.isLive ? "Live" : "Off"}
      </span>

      {/* Floating gifts and notes are absolutely positioned so they never
          contribute to the tile's height budget on a small screen. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {floats.map((float) => (
          <span
            key={float.id}
            className="concert-float absolute bottom-6 left-1/2 text-2xl"
            style={{
              marginLeft: `${float.offsetPercent}%`,
              animationDuration: `${CONCERT_FLOAT_DURATION_MS}ms`,
            }}
          >
            {float.glyph}
          </span>
        ))}
      </div>

      <p
        className="pointer-events-none absolute bottom-1.5 left-1/2 flex max-w-[92%] -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-2 py-[3px] text-[11px] font-bold"
        data-testid="concert-competitor-name"
      >
        <span className="truncate">{competitor.name}</span>
        {competitor.verified ? (
          <BadgeCheck
            className="h-3 w-3 shrink-0"
            style={{ color: SIDE_ACCENT[competitor.side] }}
            aria-label="Verified"
          />
        ) : null}
      </p>
    </div>
  );
}

/**
 * The two-competitor stage: exactly two side-by-side feeds, always in slot
 * order. There is deliberately no path to a third tile — the audience cannot be
 * promoted onto this stage.
 */
export function ConcertVideoStage({
  left,
  right,
  floats,
}: {
  left: ConcertCompetitorView;
  right: ConcertCompetitorView;
  floats: readonly ConcertFloatItem[];
}) {
  return (
    <section
      className="flex min-h-0 flex-1 gap-1.5 bg-[#0e0e12] px-1.5 py-1.5"
      data-testid="concert-video-stage"
      aria-label="Live competitors"
    >
      <CompetitorTile
        competitor={left}
        floats={floats.filter((float) => float.side === "left")}
      />
      <CompetitorTile
        competitor={right}
        floats={floats.filter((float) => float.side === "right")}
      />
    </section>
  );
}
