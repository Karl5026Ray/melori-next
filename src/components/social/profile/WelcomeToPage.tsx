"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { WELCOME_FLAG_KEY, WELCOME_VISIBLE_MS, welcomeName } from "@/lib/profileSetup";

/**
 * A brief, translucent "Welcome, Name. This is your page." shown over the
 * member's own page the first time sign-in brings them here (Karl, 20 Oct
 * 2026: "a brief moment, not a permanent banner").
 *
 * Shows only when /auth/start left the one-shot flag, then clears it, so a
 * refresh or a later visit never shows it again. Fades on its own after
 * WELCOME_VISIBLE_MS; a tap closes it sooner. "Make it yours" opens the edit
 * window for photo and bio.
 */
export default function WelcomeToPage({
  profile,
  onMakeItYours,
}: {
  profile: { display_name?: string | null; username?: string | null } | null;
  onMakeItYours: () => void;
}) {
  const [phase, setPhase] = useState<"hidden" | "in" | "out">("hidden");

  // Read and clear the flag once, on mount.
  useEffect(() => {
    let flagged = false;
    try {
      flagged = sessionStorage.getItem(WELCOME_FLAG_KEY) === "1";
      if (flagged) sessionStorage.removeItem(WELCOME_FLAG_KEY);
    } catch {
      flagged = false;
    }
    if (flagged) setPhase("in");
  }, []);

  // Fade out on its own, then unmount.
  useEffect(() => {
    if (phase === "in") {
      const t = setTimeout(() => setPhase("out"), WELCOME_VISIBLE_MS);
      return () => clearTimeout(t);
    }
    if (phase === "out") {
      const t = setTimeout(() => setPhase("hidden"), 400);
      return () => clearTimeout(t);
    }
  }, [phase]);

  if (phase === "hidden") return null;

  const name = welcomeName(profile);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-20 z-[70] flex justify-center px-4"
      aria-live="polite"
    >
      <div
        role="status"
        data-testid="welcome-to-page"
        className={`pointer-events-auto w-full max-w-md rounded-2xl border border-white/15 bg-black/45 px-5 py-4 text-white shadow-2xl backdrop-blur-md transition-all duration-300 ease-out motion-reduce:transition-none ${
          phase === "in" ? "translate-y-0 opacity-100 animate-fade-in" : "-translate-y-2 opacity-0"
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-snug">Welcome, {name}.</p>
            <p className="mt-0.5 text-sm text-white/80">
              This is your page. Add a photo and a line about you so people know it&apos;s you.
            </p>
            <button
              type="button"
              onClick={() => {
                setPhase("out");
                onMakeItYours();
              }}
              data-testid="welcome-make-it-yours"
              className="mt-3 rounded-full bg-brand-primary px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
            >
              Make it yours
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPhase("out")}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
