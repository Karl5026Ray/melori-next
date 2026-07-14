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
      <div className="max-w-6xl mx-auto flex items-center gap-1 overflow-x-auto px-4 sm:px-6">
        {/* Context label — the "you are here" cue. */}
        <span className="mr-2 shrink-0 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-secondary/50">
          {ctx.label}
        </span>

        {ctx.items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "border-brand-primary font-semibold text-brand-primary"
                  : "border-transparent text-text-secondary hover:text-brand-primary"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
