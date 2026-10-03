"use client";

// Recording notice + consent UI for live rooms (Melori Mirror recording).
//
// Illinois is an all-party-consent state: everyone in a recorded room must
// know, not just the host. Two pieces:
//   • RecordingBanner — the red "Recording" strip every participant sees while
//     the server-set room flag is on (see src/lib/mirrorRecording.ts).
//   • RecordingConsent — the modal a viewer gets when they JOIN a room that is
//     already recording. It is shown before we connect them, so nothing of
//     theirs is published until they choose. Continue = consent; Leave is fine.

type BannerProps = {
  isHost: boolean;
  // Non-hosts get a one-tap way out right on the banner.
  onLeave?: () => void;
};

export function RecordingBanner({ isHost, onLeave }: BannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-no-like
      data-testid="recording-banner"
      className="flex items-center justify-between gap-3 rounded-xl bg-red-600 px-3 py-2 text-white shadow-lg"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <p className="truncate text-sm font-semibold">
          Recording
          <span className="ml-1 font-normal text-white/90">
            {isHost
              ? "— everyone in the room can see this"
              : "— this live is being recorded by the host"}
          </span>
        </p>
      </div>
      {onLeave && (
        <button
          type="button"
          onClick={onLeave}
          className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30"
        >
          Leave
        </button>
      )}
    </div>
  );
}

type ConsentProps = {
  onContinue: () => void;
  onLeave: () => void;
};

export default function RecordingConsent({ onContinue, onLeave }: ConsentProps) {
  return (
    <div
      data-no-like
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recording-consent-title"
        data-testid="recording-consent"
        className="w-[min(90%,24rem)] rounded-2xl border border-brand-border bg-brand-surface p-6 text-center"
      >
        <div className="mx-auto mb-3 flex w-fit items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">
          <span className="h-2 w-2 rounded-full bg-white" /> Recording
        </div>
        <h2 id="recording-consent-title" className="text-base font-semibold text-text-primary">
          This room is being recorded
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          The host is recording this live and may post it to the Melori Mirror. If
          you join, your voice and video may be included if you go on camera. You
          can leave at any time.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onLeave}
            className="flex-1 rounded-full border border-brand-border px-4 py-2 text-sm font-semibold text-text-primary hover:border-brand-primary"
          >
            Leave
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="flex-1 rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
