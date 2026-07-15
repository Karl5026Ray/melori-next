import { Music } from "lucide-react";
import type { HarmonyResult } from "./types";

// Explainable "Harmony Score" badge. Shows the headline percentage plus the
// shared-taste chips that justify it — never an opaque number.
export function HarmonyBadge({
  harmony,
  compact = false,
}: {
  harmony: HarmonyResult;
  compact?: boolean;
}) {
  const score = Math.round(harmony.score);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-gradient-to-r from-melori-purple to-melori-pink px-3 py-1 text-xs font-bold text-white shadow-lg">
        <Music className="h-3.5 w-3.5" />
        {score}% music match
      </span>
      {!compact && harmony.explanation.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {harmony.explanation.slice(0, 3).map((chip, i) => (
            <span
              key={i}
              className="rounded-full border border-melori-border bg-melori-elevated px-2.5 py-0.5 text-[11px] text-melori-muted"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
