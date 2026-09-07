"use client";

import Link from "next/link";

type FooterLink = { label: string; href: string };

// Membership and Donate were removed when music became free: there is no paid
// tier to join and no donation ask on a platform that has not yet earned one.
// The links are gone rather than hidden — the whole native/web split existed
// only to keep commerce away from App Review, and there is no commerce here.
const FOOTER_LINKS: FooterLink[] = [
  { label: "Music", href: "/music" },
  { label: "Photography", href: "/photography" },
  { label: "Mission", href: "/mission" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Support", href: "/support" },
];

export default function FooterLinks() {
  return (
    <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {FOOTER_LINKS.map((link, index) => (
        <span key={link.label} className="flex items-center gap-x-2">
          {index > 0 && (
            <span aria-hidden="true" className="text-text-secondary/40 select-none">
              ·
            </span>
          )}
          <Link
            href={link.href}
            className="text-text-secondary transition-colors hover:text-brand-primary"
          >
            {link.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
