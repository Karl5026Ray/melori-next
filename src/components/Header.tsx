"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type NavItem = { label: string; href: string };
type NavGroup = { label: string; items: NavItem[] };

// Grouped desktop nav. Videos (YouTube) is its own entry under "Music".
// MM Social and Studio live under "Community"; Store is a standalone tab;
// Mission + Membership under "About". Donate stays a standalone CTA.
const navGroups: NavGroup[] = [
  {
    label: "Music",
    items: [
      { label: "Music", href: "/music" },
      { label: "Artists", href: "/artists" },
      { label: "Videos", href: "/video" },
    ],
  },
  {
    label: "Community",
    items: [
      { label: "MM Social", href: "/social/spaces" },
      { label: "Studio", href: "/studio" },
    ],
  },
  {
    label: "About",
    items: [
      { label: "Mission", href: "/mission" },
      { label: "Membership", href: "/membership" },
    ],
  },
];

const standaloneLinks: NavItem[] = [{ label: "Store", href: "/store" }];

export default function Header() {
  const [open, setOpen] = useState(false); // mobile menu
  const [openGroup, setOpenGroup] = useState<string | null>(null); // desktop dropdown
  const navRef = useRef<HTMLElement>(null);

  // Close desktop dropdowns on outside click / Escape.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenGroup(null);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

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

        {/* Desktop nav */}
        <nav
          ref={navRef}
          className="hidden md:flex items-center gap-2 lg:gap-4 text-sm"
        >
          {navGroups.map((group) => {
            const isOpen = openGroup === group.label;
            return (
              <div key={group.label} className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroup((cur) =>
                      cur === group.label ? null : group.label
                    )
                  }
                  aria-expanded={isOpen}
                  className="flex items-center gap-1 rounded-md px-2 py-1.5 text-text-secondary transition-colors hover:text-brand-primary"
                >
                  {group.label}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className={`h-3.5 w-3.5 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" />
                  </svg>
                </button>
                {isOpen && (
                  <div className="absolute left-0 mt-2 min-w-44 overflow-hidden rounded-lg border border-brand-border bg-brand-background shadow-xl">
                    {group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpenGroup(null)}
                        className="block px-4 py-2.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {standaloneLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2 py-1.5 text-text-secondary transition-colors hover:text-brand-primary"
            >
              {link.label}
            </Link>
          ))}

          <Link
            href="/donate"
            className="ml-1 rounded-md bg-brand-primary px-4 py-1.5 font-semibold text-black transition-opacity hover:opacity-90"
          >
            Donate
          </Link>
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
            {navGroups.map((group) => (
              <div key={group.label} className="py-1">
                <p className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary/60">
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}

            {standaloneLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="py-3 text-text-secondary transition-colors hover:text-brand-primary"
              >
                {link.label}
              </Link>
            ))}

            <Link
              href="/donate"
              onClick={() => setOpen(false)}
              className="my-3 rounded-md bg-brand-primary px-4 py-2.5 text-center font-semibold text-black transition-opacity hover:opacity-90"
            >
              Donate
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
