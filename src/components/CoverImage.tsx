"use client";

import { useState } from "react";

interface CoverImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  rounded?: string;
}

// Renders a cover/avatar image with a branded gradient placeholder when the
// source is missing or fails to load. Uses a plain <img> so we don't need to
// whitelist remote hosts in next.config.
export default function CoverImage({
  src,
  alt,
  className = "",
  rounded = "rounded-lg",
}: CoverImageProps) {
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !src || failed;

  if (showPlaceholder) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-brand-accent/30 to-brand-primary/40 ${rounded} ${className}`}
        aria-label={alt}
        role="img"
      >
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
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className={`object-cover ${rounded} ${className}`}
    />
  );
}
