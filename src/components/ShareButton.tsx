"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ShareButton — a compact "share" arrow that lets a visitor share the Melori
 * site. On devices that support the native share sheet (most phones) tapping
 * the arrow opens the OS share UI (which includes Instagram, Messages, etc.).
 * Everywhere else we open a small popover with explicit targets: X, Facebook,
 * WhatsApp, and Copy link.
 *
 * NOTE ON INSTAGRAM: Instagram has no public web "share URL" to pre-compose a
 * post from a link (unlike X/Facebook). The only reliable way to reach it is
 * the native share sheet, so we surface that first when available.
 */

const SHARE_URL = "https://melorimusic.org";
const SHARE_TITLE = "MELORI MUSIC";
const SHARE_TEXT =
  "Stream the full catalog free and support independent artists directly on MELORI MUSIC.";

export default function ShareButton() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCanNativeShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
  }, []);

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Always open the dropdown so the copy-link option is available. The native
  // share sheet (Instagram, Messages, etc.) is offered as an item inside it.
  const handleClick = () => setOpen((v) => !v);

  const nativeShare = async () => {
    try {
      await navigator.share({
        title: SHARE_TITLE,
        text: SHARE_TEXT,
        url: SHARE_URL,
      });
    } catch {
      // User cancelled or share failed — no-op.
    }
    setOpen(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — leave the link visible for manual copy.
    }
  };

  const enc = encodeURIComponent;
  const targets = [
    {
      label: "X",
      href: `https://twitter.com/intent/tweet?text=${enc(SHARE_TEXT)}&url=${enc(SHARE_URL)}`,
    },
    {
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${enc(SHARE_URL)}`,
    },
    {
      label: "WhatsApp",
      href: `https://api.whatsapp.com/send?text=${enc(SHARE_TEXT + " " + SHARE_URL)}`,
    },
  ];

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        aria-label="Share Melori Music"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-border text-text-primary transition-colors hover:bg-white/5"
      >
        {/* Share arrow icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-1/2 z-50 mt-2 w-48 -translate-x-1/2 rounded-2xl border border-brand-border bg-brand-surface p-2 shadow-xl"
        >
          <p className="px-2 py-1 text-xs font-semibold text-text-secondary">
            Share to
          </p>
          <button
            type="button"
            onClick={copyLink}
            role="menuitem"
            className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-text-primary transition-colors hover:bg-white/5"
          >
            {copied ? "Link copied ✓" : "Copy link"}
          </button>
          {canNativeShare && (
            <button
              type="button"
              onClick={nativeShare}
              role="menuitem"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-white/5"
            >
              Share via… (Instagram, more)
            </button>
          )}
          {targets.map((t) => (
            <a
              key={t.label}
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-white/5"
            >
              {t.label}
            </a>
          ))}
          {!canNativeShare && (
            <p className="px-3 pt-1 text-[11px] leading-tight text-text-secondary">
              For Instagram, open on your phone to use the share sheet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
