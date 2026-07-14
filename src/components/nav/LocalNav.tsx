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
    // DESKTOP ONLY. On mobile the section's items live inside the hamburger
    // drawer (Header.tsx renders getNavContext(pathname) as a "This section"
    // group), so we hide this bar entirely below `sm` — no more side-scroll and
    // no duplicate row of chips. Karl asked to "return to the dropdown
    // hamburger menu on mobile", so mobile has a single unified menu.
    <nav
      aria-label="Section"
      className="sticky top-16 z-30 hidden border-b border-brand-border bg-brand-background/80 backdrop-blur sm:block"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex flex-row items-center gap-1">
          {/* Context label — the "you are here" cue, inline with the tabs. */}
          <span className="shrink-0 py-2.5 mr-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary/50">
            {ctx.label}
          </span>

          {/* Single-line underline tabs. */}
          <div className="flex flex-nowrap gap-1">
            {ctx.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "whitespace-nowrap text-sm transition-colors " +
                    "border-b-2 px-3 py-2.5 " +
                    (active
                      ? "border-brand-primary font-semibold text-brand-primary"
                      : "border-transparent text-text-secondary hover:text-brand-primary")
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
