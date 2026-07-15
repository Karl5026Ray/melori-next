"use client";

import { useState } from "react";

interface CoverImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  rounded?: string;
  // When set and no image is available, the placeholder shows the initials
  // derived from this name (e.g. an artist/profile name) instead of the
  // generic music-note glyph.
  name?: string;
}

// First letter of the name, or the first letters of the first two words.
// Returns "" when there's nothing usable so callers fall back to the glyph.
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

// Renders a cover/avatar image with a branded gradient placeholder when the
// source is missing or fails to load. Uses a plain <img> so we don't need to
// whitelist remote hosts in next.config.
export default function CoverImage({
  src,
  alt,
  className = "",
  rounded = "rounded-lg",
  name,
}: CoverImageProps) {
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !src || failed;

  if (showPlaceholder) {
    const initials = name ? getInitials(name) : "";
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-brand-accent/30 to-brand-primary/40 ${rounded} ${className}`}
        aria-label={alt}
        role="img"
      >
        {initials ? (
          // SVG <text> so the initials scale with the container at any size.
          <svg
            viewBox="0 0 100 100"
            className="h-full w-full"
            aria-hidden
          >
            <text
              x="50"
              y="52"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={initials.length > 1 ? 42 : 52}
              fontWeight="700"
              fill="#ffffff"
            >
              {initials}
            </text>
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-1/3 w-1/3 text-white/70"
            aria-hidden
          >
            <path
              d="M9 18V5l12-2v13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx="6"
              cy="18"
              r="3"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle
              cx="18"
              cy="16"
              r="3"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        )}
      </div>
    );
  }

  return (
    // Kept as a plain <img> on purpose: `src` can be any host (Supabase,
    // VPS, or external artist URLs) and callers size it with arbitrary
    // classNames, so next/image's host allowlist + layout constraints would
    // break the long tail. We still get most of the perf win cheaply via
    // native lazy-loading + async decode, which reduces work on off-screen
    // grid/card covers without any layout or host risk.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`object-cover ${rounded} ${className}`}
    />
  );
}
