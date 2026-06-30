"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

const navLinks = [
  { label: "Music", href: "/music" },
  { label: "Artists", href: "/artists" },
  { label: "Videos", href: "/video" },
  { label: "Mission", href: "/mission" },
  { label: "Membership", href: "/membership" },
];

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-brand-background/90 backdrop-blur border-b border-brand-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image
            src="/logo/logo.png"
            alt="MELORI Music"
            width={36}
            height={36}
            priority
          />
          <span className="hidden sm:inline font-bold tracking-wide">
            MELORI MUSIC
          </span>
        </Link>

        {/* Desktop nav (unchanged at md and up) */}
        <nav className="hidden md:flex items-center gap-4 sm:gap-6 text-sm">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-text-secondary hover:text-brand-primary transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Mobile hamburger toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="md:hidden flex h-10 w-10 items-center justify-center rounded-md text-text-primary transition-colors hover:text-brand-primary"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="h-6 w-6"
            aria-hidden
          >
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu panel */}
      {open && (
        <nav
          id="mobile-nav"
          className="md:hidden border-t border-brand-border bg-brand-background"
        >
          <div className="max-w-6xl mx-auto px-4 py-2 flex flex-col">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setOpen(false)}
                className="py-3 text-text-secondary transition-colors hover:text-brand-primary"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
