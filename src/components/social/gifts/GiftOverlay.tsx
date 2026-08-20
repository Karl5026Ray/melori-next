"use client";

import { useEffect } from "react";
import { giftMediaKind, type GiftSignal } from "@/lib/gifting";

export function GiftOverlay({
  signal,
  onFinished,
}: {
  signal: GiftSignal | null;
  onFinished: () => void;
}) {
  useEffect(() => {
    if (!signal) return;
    const timer = window.setTimeout(onFinished, signal.gift.duration_ms);
    return () => window.clearTimeout(timer);
  }, [signal, onFinished]);

  const mediaKind = signal ? giftMediaKind(signal.gift.asset_url) : null;

  // @google/model-viewer registers a browser-only custom element at import
  // time, so it must never load during SSR — pull it in lazily, client-side,
  // only once a GLB gift actually needs to render.
  useEffect(() => {
    if (mediaKind === "model") {
      void import("@google/model-viewer");
    }
  }, [mediaKind]);

  if (!signal) return null;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-6"
      role="status"
      aria-live="polite"
      data-testid="gift-overlay"
    >
      <div className="max-h-full max-w-full text-center">
        {mediaKind === "video" ? (
          <video
            key={signal.giftSendId}
            autoPlay
            muted
            playsInline
            className="max-h-[72dvh] max-w-[92vw] rounded-3xl object-contain shadow-2xl"
            src={signal.gift.asset_url}
          />
        ) : mediaKind === "model" ? (
          <model-viewer
            key={signal.giftSendId}
            src={signal.gift.asset_url}
            alt={`${signal.gift.name} gift`}
            auto-rotate
            autoplay
            camera-controls
            disable-zoom
            interaction-prompt="none"
            loading="eager"
            reveal="auto"
            className="mx-auto h-[60dvh] max-h-[60dvh] w-[80vw] max-w-[92vw] rounded-3xl shadow-2xl"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signal.gift.asset_url}
            alt={`${signal.gift.name} gift`}
            className="max-h-[72dvh] max-w-[92vw] rounded-3xl object-contain shadow-2xl"
          />
        )}
        <p className="mt-3 rounded-full bg-black/75 px-4 py-2 text-sm font-semibold text-white">
          {signal.senderName ? `${signal.senderName} sent ` : "A fan sent "}
          {signal.gift.name}
        </p>
      </div>
    </div>
  );
}
