"use client";

// LocalNav — the thin, context-aware secondary bar.
//
// It renders UNDER the persistent global header and shows ONLY the menu items
// belonging to the current page's context (see navContexts.ts). This is the
// clutter-trimming layer Karl asked for: each section sheds unrelated items,
// but the global header above never changes, so users don't get lost.
//
// Guardrails baked in (per NN/g):
//   • A context label on the left tells you WHERE you are ("Listening", …).
//   • The active item is highlighted with aria-current="page".
//   • Wrapped in <nav aria-label="Section"> so it's distinct from the primary
//     <nav> for assistive tech.
//   • Renders nothing on the Home/neutral context (no bar = no clutter).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavContext } from "./navContexts";

/** True when a nav item should show as the current page. */
function isActive(pathname: string, href: string): boolean {
  const base = href.split("?")[0];
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}

export default function LocalNav() {
  const pathname = usePathname() ?? "/";
  const ctx = getNavContext(pathname);

  // Home / neutral contexts carry no local items — render nothing so the page
  // stays clean.
  if (ctx.items.length === 0) return null;

  return (
    <nav
      aria-label="Section"
      className="sticky top-16 z-30 border-b border-brand-border bg-brand-background/80 backdrop-blur"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Context label — the "you are here" cue. On mobile it sits on its own
           line above the wrapped chips; on desktop it's inline with the tabs. */}
        <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-1 sm:py-0">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-text-secondary/50 sm:mr-2 sm:py-2.5">
            {ctx.label}
          </span>

          {/* Items.
             - Mobile: wrapping pill chips — every item is visible at once, no
               horizontal side-scroll (this is the flow Karl asked to fix).
             - Desktop (sm+): single-line underline tabs as before. */}
          <div className="flex flex-wrap gap-1.5 sm:flex-nowrap sm:gap-1">
            {ctx.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    // Mobile: rounded chip. Desktop: underline tab.
                    "whitespace-nowrap text-sm transition-colors " +
                    "rounded-full px-3 py-1.5 sm:rounded-none sm:border-b-2 sm:px-3 sm:py-2.5 " +
                    (active
                      ? "bg-brand-primary font-semibold text-white sm:bg-transparent sm:border-brand-primary sm:text-brand-primary"
                      : "bg-white/[0.04] text-text-secondary hover:text-brand-primary sm:bg-transparent sm:border-transparent")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
