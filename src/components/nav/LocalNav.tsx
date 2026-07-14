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
import { useCallback, useEffect, useRef, useState } from "react";
import { getNavContext } from "./navContexts";

/** True when a nav item should show as the current page. */
function isActive(pathname: string, href: string): boolean {
  const base = href.split("?")[0];
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}

// Width of the edge fade, in px. The scroller gets a horizontal mask that
// fades to transparent over this distance on whichever side still has
// off-screen content — a clear "there's more to scroll" cue.
const FADE = 28;

export default function LocalNav() {
  const pathname = usePathname() ?? "/";
  const ctx = getNavContext(pathname);

  // Track whether the scroller can scroll further left / right so we only fade
  // the edge(s) that actually have hidden content (no fade at the very start
  // or the very end).
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateFades = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft < maxScroll - 1);
  }, []);

  useEffect(() => {
    updateFades();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateFades, { passive: true });
    window.addEventListener("resize", updateFades);
    return () => {
      el.removeEventListener("scroll", updateFades);
      window.removeEventListener("resize", updateFades);
    };
    // Re-run when the context (and therefore the item set) changes.
  }, [updateFades, ctx.id]);

  // Home / neutral contexts carry no local items — render nothing so the page
  // stays clean.
  if (ctx.items.length === 0) return null;

  // Build the horizontal mask gradient: transparent -> opaque over FADE px on
  // whichever edge has more content. When neither side can scroll, no mask is
  // applied so nothing is dimmed.
  const leftStop = canLeft ? `${FADE}px` : "0px";
  const rightStop = canRight ? `${FADE}px` : "0px";
  const maskImage =
    canLeft || canRight
      ? `linear-gradient(to right, transparent 0, #000 ${leftStop}, #000 calc(100% - ${rightStop}), transparent 100%)`
      : undefined;

  return (
    <nav
      aria-label="Section"
      // Mobile already reaches every one of these destinations from the bottom
      // tab bar's M-menu launcher, so this scrolling context bar is pure
      // duplication on small screens (Karl: "they are all the same thing in too
      // many places"). Hide it below md; desktop keeps it unchanged.
      className="hidden md:block sticky top-16 z-30 border-b border-brand-border bg-brand-background/80 backdrop-blur"
    >
      <div
        ref={scrollerRef}
        className="max-w-6xl mx-auto flex items-center gap-1 overflow-x-auto px-4 sm:px-6"
        style={
          maskImage
            ? {
                WebkitMaskImage: maskImage,
                maskImage,
              }
            : undefined
        }
      >
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
