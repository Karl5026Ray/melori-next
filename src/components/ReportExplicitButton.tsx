"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authClient";

// "Report as explicit" — lets any signed-in listener flag a track that should
// carry the E badge but doesn't. Each listener counts once per track (the
// server dedupes), and flags land in the admin Explicit Reports queue where
// Karl can mark the track explicit or take it down in one click.
//
// Renders nothing for a track already marked explicit: there is nothing to
// report. Sized to sit inline under a now-playing title.
export default function ReportExplicitButton({
  track,
  className = "",
}: {
  track: {
    id: number | string;
    sourceType?: "legacy" | "studio";
    explicit?: boolean | null;
  } | null;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );

  // A different track is a fresh report.
  const key = track ? `${track.sourceType ?? "legacy"}:${track.id}` : "";
  useEffect(() => {
    setState("idle");
  }, [key]);

  if (!track || track.explicit) return null;

  const report = async () => {
    if (state === "sending" || state === "done") return;
    setState("sending");
    try {
      const res = await authFetch("/api/tracks/explicit-flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: track.sourceType ?? "legacy",
          id: String(track.id),
        }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <button
      type="button"
      onClick={report}
      disabled={state === "sending" || state === "done"}
      className={`text-[11px] text-text-secondary underline-offset-2 transition-colors hover:text-brand-primary hover:underline disabled:cursor-default disabled:no-underline disabled:hover:text-text-secondary ${className}`}
      title="Tell us this song has explicit content but no E badge"
    >
      {state === "done"
        ? "Thanks, reported"
        : state === "error"
          ? "Couldn't report. Try again"
          : state === "sending"
            ? "Reporting…"
            : "Report as explicit"}
    </button>
  );
}
