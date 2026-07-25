"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Sparkles } from "lucide-react";
import { SOCIAL_NAV_ITEMS, isSocialNavCurrent } from "@/lib/socialNav";

// "Social" nav button — a sibling of the "Discover" pill in the profile action
// row, styled and sized to match it. Discover navigates; Social opens the four
// social apps as a dropdown.
export default function SocialMenuButton() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const activeItem = SOCIAL_NAV_ITEMS.some((item) =>
    isSocialNavCurrent(pathname, item.href),
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-current={activeItem ? "page" : undefined}
        className={`inline-flex items-center gap-1.5 px-6 py-2.5 rounded-full border font-medium text-sm text-white transition ${
          activeItem
            ? "bg-melori-purple/30 border-melori-purple"
            : "bg-melori-purple/15 border-melori-purple/40 hover:bg-melori-purple/25"
        }`}
      >
        <Sparkles className="h-4 w-4" />
        Social
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Social"
          className="absolute left-0 z-30 mt-2 min-w-52 overflow-hidden rounded-xl border border-melori-border bg-melori-elevated shadow-xl"
        >
          {SOCIAL_NAV_ITEMS.map((item) => {
            const current = isSocialNavCurrent(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                aria-current={current ? "page" : undefined}
                className={`block px-4 py-2.5 text-sm transition ${
                  current
                    ? "bg-melori-purple/15 font-medium text-melori-purple"
                    : "text-melori-text hover:bg-white/5 hover:text-melori-purple"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
