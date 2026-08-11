"use client";

import { useState } from "react";
import { Camera, Check } from "lucide-react";
import { requestUserMedia, formatCaptureError, type CaptureErrorInfo } from "@/lib/mediaCapture";
import { MediaPermissionNotice } from "@/components/media/MediaPermissionNotice";
import { markMediaSetupSeen } from "@/lib/mediaSetupMarker";

// Reusable one-time "turn on your camera and microphone" step, shown once right
// after signup.
//
// RULES BAKED IN HERE
//   * The browser prompt is only ever triggered by an explicit button press.
//     Requesting on page load produces a prompt with no context, which users
//     reflexively deny — and a denial is sticky for the whole origin.
//   * Camera and microphone are requested TOGETHER in one getUserMedia call, so
//     the user sees one prompt rather than two.
//   * The tracks are stopped immediately on success. This step exists to obtain
//     the grant, not to hold a live capture — leaving the camera light on while
//     the user reads a confirmation screen is alarming and drains battery.
//   * Skip is always available, and a denial is not a dead end: the guidance
//     from formatCaptureError() is shown inline, non-modally, and Continue
//     stays available.
export function MediaSetupCard({
  onDone,
  continueLabel = "Continue",
}: {
  /** Called for both Continue and Skip; the marker is already written. */
  onDone: (outcome: "granted" | "skipped" | "denied") => void;
  continueLabel?: string;
}) {
  const [status, setStatus] = useState<"idle" | "requesting" | "granted" | "denied">(
    "idle",
  );
  const [error, setError] = useState<CaptureErrorInfo | null>(null);

  const enable = async () => {
    if (status === "requesting") return;
    setError(null);
    setStatus("requesting");
    try {
      const stream = await requestUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      // Release the devices right away — the grant persists without them.
      stream.getTracks().forEach((track) => track.stop());
      markMediaSetupSeen("granted");
      setStatus("granted");
    } catch (err) {
      markMediaSetupSeen("denied");
      setError(formatCaptureError(err, "setup"));
      setStatus("denied");
    }
  };

  const skip = () => {
    markMediaSetupSeen("skipped");
    onDone("skipped");
  };

  return (
    <section
      data-testid="media-setup-card"
      aria-labelledby="media-setup-heading"
      className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-left"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#c9a96e]/15 text-[#c9a96e]">
        <Camera className="h-6 w-6" aria-hidden="true" />
      </div>

      <h1 id="media-setup-heading" className="text-2xl font-bold">
        Turn on camera &amp; microphone
      </h1>
      <p className="mt-2 text-sm text-[#9a9a9a]" data-testid="media-setup-explainer">
        Melori uses your camera and microphone for calls, Spaces and Mirror. Your
        browser will ask once — nothing is recorded, and we switch the camera
        straight back off after you allow it. You can do this later instead.
      </p>
      <p className="mt-2 text-xs text-[#7a7a7a]">
        This permission is remembered by this browser on this device only, so
        you may be asked again on another phone or browser.
      </p>

      {status === "granted" && (
        <p
          role="status"
          aria-live="polite"
          data-testid="media-setup-success"
          className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-300"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Camera and microphone are ready. We&apos;ve switched them off again
          until you start a call.
        </p>
      )}

      {error && (
        <MediaPermissionNotice
          info={error}
          onDismiss={() => setError(null)}
          testId="media-setup-error"
          className="mt-4"
        />
      )}

      <div className="mt-6 flex flex-col gap-3">
        {status !== "granted" && (
          <button
            type="button"
            onClick={enable}
            disabled={status === "requesting"}
            data-testid="media-setup-enable"
            className="w-full rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] py-3 text-sm font-semibold text-[#0a0a0a] disabled:opacity-50"
          >
            {status === "requesting"
              ? "Waiting for your browser…"
              : status === "denied"
                ? "Try again"
                : "Allow camera & microphone"}
          </button>
        )}

        {status === "granted" ? (
          <button
            type="button"
            onClick={() => onDone("granted")}
            data-testid="media-setup-continue"
            className="w-full rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] py-3 text-sm font-semibold text-[#0a0a0a]"
          >
            {continueLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={skip}
            data-testid="media-setup-skip"
            className="w-full rounded-full border border-white/15 py-3 text-sm font-medium text-[#bbb] transition hover:border-white/30 hover:text-white"
          >
            Skip for now
          </button>
        )}
      </div>
    </section>
  );
}
