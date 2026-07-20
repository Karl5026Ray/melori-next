import type { ReactElement } from "react";
import Image from "next/image";
import Link from "next/link";

const footerLinks = [
  { label: "Music", href: "/music" },
  { label: "Photography", href: "/photography" },
  { label: "Mission", href: "/mission" },
  { label: "Membership", href: "/membership" },
  { label: "Donate", href: "/donate" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Support", href: "/support" },
];

// Basic social destinations for now (platform home pages). These can be
// swapped for real Melori handles anytime by editing the href values.
const socialLinks: { label: string; href: string; icon: ReactElement }[] = [
  {
    label: "Facebook",
    href: "https://facebook.com",
    icon: (
      <path d="M13.5 9H15V6.5h-1.5c-1.66 0-3 1.34-3 3V11H9v2.5h1.5V20H13v-6.5h1.7l.3-2.5H13V9.75c0-.41.34-.75.75-.75z" />
    ),
  },
  {
    label: "Instagram",
    href: "https://instagram.com",
    icon: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
        <circle cx="12" cy="12" r="3.5" />
        <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    label: "TikTok",
    href: "https://tiktok.com",
    icon: (
      <path d="M14 4c.5 2 1.8 3.3 3.8 3.6V10c-1.4 0-2.7-.4-3.8-1.1V15a4.5 4.5 0 1 1-4.5-4.5c.3 0 .6 0 .9.1v2.5a2 2 0 1 0 1.4 1.9V4H14z" />
    ),
  },
  {
    label: "YouTube",
    href: "https://youtube.com",
    icon: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="3" />
        <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    label: "X",
    href: "https://x.com",
    icon: (
      <path
        d="M4 4l16 16M20 4L4 20"
        strokeLinecap="round"
      />
    ),
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-brand-border bg-brand-background">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Image src="/logo/logo.png" alt="MELORI Music" width={32} height={32} />
          <span className="font-bold tracking-wide">MELORI MUSIC</span>
        </div>

        {/* Links */}
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {footerLinks.map((link, i) => (
<span key={link.label} className="flex items-center gap-x-2">
{i > 0 && (
<span aria-hidden="true" className="text-text-secondary/40 select-none">·</span>
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

        {/* Social */}
        <div className="flex items-center gap-3">
          {socialLinks.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`MELORI Music on ${s.label}`}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-brand-border text-text-secondary transition-colors hover:border-brand-primary hover:text-brand-primary"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
                aria-hidden
              >
                {s.icon}
              </svg>
            </a>
          ))}
        </div>
      </div>

      <div className="border-t border-brand-border">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-text-secondary">
          © 2026 MELORI MUSIC. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
