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
 * card. If Amazon's image fails to load, it drops back to the title card
 * instead of showing a broken-image icon.
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
        className="aspect-[3/4] w-full rounded-md bg-white/5 object-cover shadow-lg"
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`flex aspect-[3/4] w-full flex-col justify-between rounded-md bg-gradient-to-br ${
        GRADIENT[seriesId] ?? "from-zinc-800 to-zinc-900"
      } p-4 shadow-lg`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-white/70">
        {seriesName}
      </span>
      <span className={`font-bold leading-tight text-white ${large ? "text-2xl" : "text-lg"}`}>
        {title}
      </span>
      <span className="text-[10px] text-white/70">Karl Ray</span>
    </div>
  );
}
