"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authClient";
import { Circle, Square, Loader2 } from "lucide-react";

// Host-only recording controls for a live session, shown inside the live room.
//
// Flow (item 8 — "Go live on Melori Mirror records directly to the mirror as
// content; prompt the user to post the LIVE"):
//   1. Host taps Record → POST /api/mirror/recording/start (LiveKit egress).
//   2. Host taps Stop (or ends the live) → POST /api/mirror/recording/stop.
//   3. We prompt "Post this LIVE to the Mirror?" → on YES,
//      POST /api/mirror/recording/publish creates a Mirror post (social_videos).
//
// Recording may not be configured yet (no S3 egress creds). In that case the
// start call returns { configured:false } and we surface a friendly note rather
// than an error, so the live itself is never blocked.

type Props = {
  spaceId: string;
  // Called after the publish decision is made (posted or skipped) so the parent
  // can continue tearing down / navigating away. Optional.
  onDone?: () => void;
  // When true, the component immediately runs the stop+prompt flow (used when
  // the host ends the live while recording). Otherwise it shows the Record btn.
  autoStopAndPrompt?: boolean;
  // Reports whether a recording is currently active, so the parent can route
  // the host's "End" action through the post-prompt.
  onRecordingChange?: (recording: boolean) => void;
};

type Phase = "idle" | "starting" | "recording" | "stopping" | "prompt" | "publishing" | "done";

export default function MirrorRecordingControls({
  spaceId,
  onDone,
  autoStopAndPrompt,
  onRecordingChange,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  // Keep the parent informed of active-recording state.
  useEffect(() => {
    onRecordingChange?.(phase === "recording" || phase === "stopping");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const start = useCallback(async () => {
    setError(null);
    setPhase("starting");
    try {
      const res = await authFetch("/api/mirror/recording/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.configured === false) {
        setNotConfigured(true);
        setPhase("idle");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Could not start recording");
      setPhase("recording");
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  }, [spaceId]);

  const stop = useCallback(async () => {
    setError(null);
    setPhase("stopping");
    try {
      const res = await authFetch("/api/mirror/recording/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not stop recording");
      // Offer to post the LIVE.
      setPhase("prompt");
    } catch (e) {
      setError((e as Error).message);
      setPhase("recording");
    }
  }, [spaceId]);

  const publish = useCallback(async () => {
    setError(null);
    setPhase("publishing");
    try {
      const res = await authFetch("/api/mirror/recording/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, title: title.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not post your live");
      setPhase("done");
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
      setPhase("prompt");
    }
  }, [spaceId, title, onDone]);

  const skip = useCallback(() => {
    setPhase("done");
    onDone?.();
  }, [onDone]);

  // When mounted in "end the live" mode, immediately stop the recording and
  // show the post-prompt. Runs once on mount regardless of initial phase (this
  // instance is a fresh overlay, so its phase starts at idle).
  useEffect(() => {
    if (autoStopAndPrompt) {
      void stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (notConfigured) {
    return (
      <div className="rounded-lg bg-black/60 px-3 py-2 text-xs text-white/80">
        Recording isn&apos;t set up yet. Ask the admin to enable live recording.
      </div>
    );
  }

  // "Post this LIVE?" prompt (also renders the publishing / done states).
  if (phase === "prompt" || phase === "publishing" || phase === "done") {
    if (phase === "done") return null;
    return (
      <div className="w-full max-w-sm rounded-2xl bg-neutral-900 p-4 text-white shadow-xl">
        <h3 className="text-base font-semibold">Post this LIVE to the Mirror?</h3>
        <p className="mt-1 text-sm text-white/70">
          Your recording will appear in the Melori Mirror feed as a video post.
        </p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a title (optional)"
          maxLength={120}
          className="mt-3 w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none placeholder:text-white/40"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            onClick={skip}
            disabled={phase === "publishing"}
            className="flex-1 rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium hover:bg-neutral-600 disabled:opacity-50"
          >
            Not now
          </button>
          <button
            onClick={publish}
            disabled={phase === "publishing"}
            className="flex-1 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold hover:bg-orange-400 disabled:opacity-50"
          >
            {phase === "publishing" ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-4 w-4 animate-spin" /> Posting…
              </span>
            ) : (
              "Post it"
            )}
          </button>
        </div>
      </div>
    );
  }

  // Record / Stop toggle button.
  const recording = phase === "recording" || phase === "stopping";
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={recording ? stop : start}
        disabled={phase === "starting" || phase === "stopping"}
        aria-label={recording ? "Stop recording" : "Record this live"}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow disabled:opacity-60 ${
          recording ? "bg-red-600 text-white" : "bg-white/90 text-neutral-900 hover:bg-white"
        }`}
      >
        {phase === "starting" || phase === "stopping" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : recording ? (
          <Square className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Circle className="h-3.5 w-3.5 fill-red-600 text-red-600" />
        )}
        {recording ? "Recording" : "Record"}
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
