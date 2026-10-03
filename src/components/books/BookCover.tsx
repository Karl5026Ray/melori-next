"use client";

import { useEffect, useRef, useState } from "react";

// Series colours live here, not in src/lib/books.ts: Tailwind only scans
// src/app and src/components, so class names written in src/lib never get
// generated and the fallback covers rendered as blank boxes.
const GRADIENT: Record<string, string> = {
  "melori-band": "from-indigo-900 via-purple-800 to-blue-900",
  "without-the-blacks": "from-stone-950 via-amber-800 to-yellow-600",
  "hikari-discovers": "from-sky-700 via-cyan-600 to-teal-700",
  "say-it-out-loud": "from-rose-700 via-orange-600 to-amber-600",
};

type Props = {
  title: string;
  seriesId: string;
  seriesName: string;
  src: string | null;
  large?: boolean;
};

/**
 * Amazon's cover when the book has an ASIN, otherwise a series-coloured title
 * card. Every cover is cropped to the same 2:3 shape (Karl, 2026-10-03: "I need
 * all of them to be sized in unison") — Kindle, 6x9 and 8.5x11 covers differ.
 * If Amazon's image fails to load, it drops back to the title card instead of
 * showing a broken-image icon.
 */
export default function BookCover({ title, seriesId, seriesName, src, large }: Props) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // An image that fails before React hydrates never fires onError, so check
  // once on mount as well.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={src}
        alt={`Cover of ${title}`}
        loading={large ? "eager" : "lazy"}
        onError={() => setFailed(true)}
        className="aspect-[2/3] w-full object-cover shadow-md"
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`flex aspect-[2/3] w-full flex-col justify-between bg-gradient-to-br ${
        GRADIENT[seriesId] ?? "from-zinc-800 to-zinc-900"
      } p-2 shadow-md sm:p-3`}
    >
      <span className="text-[8px] font-semibold uppercase tracking-widest text-white/70 sm:text-[10px]">
        {seriesName}
      </span>
      <span className={`font-bold leading-tight text-white ${large ? "text-2xl" : "text-xs sm:text-base"}`}>
        {title}
      </span>
      <span className="text-[8px] text-white/70 sm:text-[10px]">Karl Ray</span>
    </div>
  );
}
