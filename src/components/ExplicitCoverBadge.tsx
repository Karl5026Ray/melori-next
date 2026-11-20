import { useId } from "react";

// The Melori explicit seal drawn ON TOP of a cover: a red ring with EXPLICIT
// spelled around it and the Melori M in the middle (Karl's pick, "Option B",
// 20 Nov 2026). It sits in the lower-right of the cover's lower third.
//
// It is an overlay, never baked into the artwork: it follows the track's
// `explicit` flag, so clearing the flag removes it everywhere at once.
//
// Ring text only reads when the seal is big enough. A CSS container query in
// globals.css (.explicit-seal) swaps to a plain red ring with just the M when
// the seal is under 80px wide (cards, the player bar), so small covers get a
// crisp mark instead of blurred letters. Browsers without container queries
// get the plain ring.
//
// The parent must be `position: relative` (CoverImage handles this).
// Server-safe: useId works in Server and Client Components.

const RING_TEXT = "EXPLICIT • EXPLICIT • ";
// Circumference of the r=39 text path in the 100x100 viewBox.
const TEXT_LENGTH = 2 * Math.PI * 39;

export default function ExplicitCoverBadge({
  explicit,
  className = "",
}: {
  explicit?: boolean | null;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  if (!explicit) return null;
  const pathId = `explicit-seal-path-${uid}`;

  return (
    <span
      role="img"
      aria-label="Explicit"
      title="Explicit"
      className={`explicit-seal pointer-events-none absolute bottom-[4%] right-[4%] block aspect-square w-[27%] min-w-[18px] max-w-[180px] select-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)] ${className}`}
    >
      {/* Full seal: EXPLICIT around the ring. */}
      <svg viewBox="0 0 100 100" className="explicit-seal__full h-full w-full" aria-hidden>
        <defs>
          {/* Starts at the left and runs clockwise over the top. */}
          <path id={pathId} d="M 11,50 a 39,39 0 1,1 78,0 a 39,39 0 1,1 -78,0" />
        </defs>
        <circle cx="50" cy="50" r="50" fill="#e11d2a" />
        <circle cx="50" cy="50" r="29" fill="#0e0e12" />
        <text
          fill="#ffffff"
          fontSize="13.5"
          fontWeight="900"
          style={{ fontFamily: "inherit" }}
        >
          {/* dy drops the baseline inward so the caps sit centred in the band
              (dominant-baseline on textPath is unreliable in Safari). */}
          <textPath href={`#${pathId}`} textLength={TEXT_LENGTH} lengthAdjust="spacing">
            <tspan dy="4.7">{RING_TEXT}</tspan>
          </textPath>
        </text>
        <image href="/logo/logo-badge.png" x="29" y="29" width="42" height="42" />
      </svg>

      {/* Compact seal: plain red ring with the M (small covers). */}
      <svg viewBox="0 0 100 100" className="explicit-seal__compact h-full w-full" aria-hidden>
        <circle cx="50" cy="50" r="50" fill="#e11d2a" />
        <circle cx="50" cy="50" r="36" fill="#0e0e12" />
        <image href="/logo/logo-badge.png" x="22" y="22" width="56" height="56" />
      </svg>
    </span>
  );
}
