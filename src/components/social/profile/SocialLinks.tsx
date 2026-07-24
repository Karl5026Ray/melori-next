"use client";

import { Link2 } from "lucide-react";
import type { SocialLink } from "@/types/social";

// Renders a profile's clickable links (up to 5). External links open in a new
// tab with rel="noopener noreferrer nofollow" so we never leak the referrer or
// grant the target window.opener access, and so we don't pass link equity to
// arbitrary user-supplied URLs. Renders nothing when there are no links.
export default function SocialLinks({
  links,
  className = "",
}: {
  links: SocialLink[] | null | undefined;
  className?: string;
}) {
  const items = (Array.isArray(links) ? links : []).filter((l) => l?.url);
  if (items.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {items.map((link, i) => (
        <a
          key={`${link.url}-${i}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1.5 rounded-full border border-melori-border bg-melori-elevated px-3 py-1.5 text-xs font-medium text-melori-text transition hover:border-melori-purple/40 hover:text-melori-purple"
        >
          <Link2 className="h-3.5 w-3.5" />
          {link.label || link.url}
        </a>
      ))}
    </div>
  );
}
