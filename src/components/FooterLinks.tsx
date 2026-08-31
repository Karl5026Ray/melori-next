"use client";

import Link from "next/link";
import { useIsNativeApp } from "@/components/NativeAppProvider";

type FooterLink = { label: string; href: string; commerce?: boolean };

const FOOTER_LINKS: FooterLink[] = [
  { label: "Music", href: "/music" },
  { label: "Photography", href: "/photography" },
  { label: "Mission", href: "/mission" },
  { label: "Membership", href: "/membership", commerce: true },
  { label: "Donate", href: "/donate", commerce: true },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Support", href: "/support" },
];

export default function FooterLinks() {
  const isNativeApp = useIsNativeApp();
  const links = FOOTER_LINKS.filter((link) => !(isNativeApp && link.commerce));

  return (
    <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {links.map((link, index) => (
        <span
          key={link.label}
          data-native-hide={link.commerce ? "" : undefined}
          className="flex items-center gap-x-2"
        >
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
