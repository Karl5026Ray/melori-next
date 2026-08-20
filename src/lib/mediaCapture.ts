// Single entry point for camera/microphone capture.
//
// WHY THIS EXISTS
// ---------------
// `navigator.mediaDevices` is not always present. When it is absent, reading
// `.getUserMedia` off it throws a raw TypeError — on iOS WKWebView that reads
//
//   undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')
//
// which is what MM Faces and MM Spaces showed users inside the App Store build
// while the same pages worked in mobile Safari. Three things remove the API
// entirely rather than merely denying permission:
//
//   1. iOS WKWebView with no NSCameraUsageDescription / NSMicrophoneUsageDescription
//      in Info.plist (fixed natively in mobile/scripts/configure-ios.sh).
//   2. A non-secure context — any origin that is not https:// or localhost.
//   3. iOS below 14.3, where WKWebView has no capture support at all.
//
// The native gate is the real fix; this module exists so that if capture is ever
// unavailable again the user sees an explanation and a next step instead of a
// JavaScript error string.

export type CaptureUnavailableReason =
  | "insecure-context"
  | "no-media-devices"
  | "no-getusermedia"
  | "no-navigator";

export class MediaCaptureUnavailableError extends Error {
  readonly reason: CaptureUnavailableReason;

  constructor(reason: CaptureUnavailableReason, message: string) {
    super(message);
    this.name = "MediaCaptureUnavailableError";
    this.reason = reason;
  }
}

function isInAppWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Capacitor exposes a global on the native wrapper; the UA check covers the
  // iOS WKWebView case where the bridge has not injected yet.
  const hasCapacitor =
    typeof window !== "undefined" && Boolean((window as any).Capacitor);
  const iosWebView = /iPad|iPhone|iPod/.test(ua) && !/Safari\//.test(ua);
  return hasCapacitor || iosWebView;
}

/**
 * Why capture is unavailable, or `null` when it is available.
 * Never throws, so it is safe to call while rendering.
 */
export function getCaptureUnavailableReason(): CaptureUnavailableReason | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return "no-navigator";
  }
  if (window.isSecureContext === false) return "insecure-context";
  if (!navigator.mediaDevices) return "no-media-devices";
  if (typeof navigator.mediaDevices.getUserMedia !== "function") {
    return "no-getusermedia";
  }
  return null;
}

export function isCaptureSupported(): boolean {
  return getCaptureUnavailableReason() === null;
}

export function captureUnavailableMessage(
  reason: CaptureUnavailableReason,
): string {
  if (reason === "insecure-context") {
    return "Camera and microphone need a secure (https) connection. Open Melori at https://melorimusic.org and try again.";
  }
  if (isInAppWebView()) {
    return "This version of the Melori app can't reach your camera and microphone. Update to the latest version from the App Store, or tap Open in Safari to go live now.";
  }
  return "This browser can't reach your camera and microphone. Try the latest Safari, Chrome or Edge, and make sure you're on iOS 14.3 or newer.";
}

/**
 * `navigator.mediaDevices.getUserMedia` with the API-missing case turned into a
 * readable, actionable error. Every capture path should call this instead of
 * touching `navigator.mediaDevices` directly.
 */
export async function requestUserMedia(
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  const reason = getCaptureUnavailableReason();
  if (reason) {
    throw new MediaCaptureUnavailableError(
      reason,
      captureUnavailableMessage(reason),
    );
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

// ---------------------------------------------------------------------------
// Blocked / failed capture messaging
// ---------------------------------------------------------------------------
//
// `getUserMedia` rejects with a small set of DOMException names, and each one
// needs a different sentence and a different next step. Before this existed
// every caller showed the same "Could not access camera/microphone" string (or
// an alert()), which tells a user with a denied permission nothing about how to
// undo it and tells a user whose camera is held by Zoom the wrong thing
// entirely. Everything here is pure so the exact wording can be unit-tested.

/** What the caller was trying to capture. Drives camera+mic vs mic-only copy. */
export type CaptureIntent = "video" | "voice" | "setup";

export type CaptureErrorKind =
  | "blocked" // NotAllowedError / PermissionDeniedError
  | "not-found" // NotFoundError / DevicesNotFoundError
  | "in-use" // NotReadableError / TrackStartError
  | "insecure" // SecurityError, or MediaCaptureUnavailableError(insecure-context)
  | "unsupported" // MediaCaptureUnavailableError (API missing)
  | "unknown";

export interface CaptureErrorInfo {
  kind: CaptureErrorKind;
  /** Short headline, safe to render as the alert title. */
  title: string;
  /** One or two sentences explaining what happened. */
  message: string;
  /** Concrete, per-browser steps. Render as a list. */
  steps: string[];
}

function devices(intent: CaptureIntent): string {
  return intent === "voice" ? "microphone" : "camera and microphone";
}

function devicesTitle(intent: CaptureIntent): string {
  return intent === "voice" ? "Microphone" : "Camera and microphone";
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent || "");
}

/** Per-platform "how to un-block it" steps. */
function unblockSteps(intent: CaptureIntent): string[] {
  const what = intent === "voice" ? "Microphone" : "Camera and Microphone";
  if (isIOS()) {
    return [
      `Safari: tap the "aA" icon in the address bar → Website Settings → set ${what} to Allow, then reload.`,
      `iOS Settings → Safari → ${what}: make sure melorimusic.org is not set to Deny.`,
      `iOS Settings → Privacy & Security → ${what}: check your browser or the Melori app is switched on.`,
    ];
  }
  return [
    `Chrome / Edge: click the lock (or camera) icon left of the address bar → Site settings → allow ${devices(intent)}, then reload.`,
    `Safari on Mac: Safari → Settings → Websites → ${what} → set melorimusic.org to Allow.`,
    `Firefox: click the lock icon → Connection secure → clear the blocked permission, then reload.`,
    `If the browser never asked, also check your operating system privacy settings (macOS: System Settings → Privacy & Security → ${what}).`,
  ];
}

function errorName(err: unknown): string {
  if (err && typeof err === "object") {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/**
 * Turn any capture failure into user-facing copy. Never throws, always returns
 * something renderable — an unrecognised error still gets a usable next step.
 */
export function formatCaptureError(
  err: unknown,
  intent: CaptureIntent = "video",
): CaptureErrorInfo {
  if (err instanceof MediaCaptureUnavailableError) {
    const insecure = err.reason === "insecure-context";
    return {
      kind: insecure ? "insecure" : "unsupported",
      title: insecure
        ? "A secure connection is required"
        : `${devicesTitle(intent)} aren't available here`,
      message: err.message,
      steps: insecure
        ? [
            "Open https://melorimusic.org (not http://) and try again.",
            "On a local build, use https or http://localhost — other origins can't use capture.",
          ]
        : [
            "Update to the latest version of Safari, Chrome or Edge.",
            "In the Melori app, update from the App Store or open melorimusic.org in Safari.",
          ],
    };
  }

  const name = errorName(err);

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      kind: "blocked",
      title: `${devicesTitle(intent)} access is blocked`,
      message:
        intent === "voice"
          ? "Your browser is blocking Melori from using your microphone, so the call can't start. Nothing was sent to the other person."
          : "Your browser is blocking Melori from using your camera and microphone, so the call can't start. Nothing was sent to the other person.",
      steps: unblockSteps(intent),
    };
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      kind: "not-found",
      title: `No ${devices(intent)} found`,
      message:
        intent === "voice"
          ? "We couldn't find a microphone on this device."
          : "We couldn't find a camera and microphone on this device. A voice call may still work.",
      steps: [
        "Plug in or switch on your headset, webcam or external microphone, then try again.",
        "Close any other app that may have exclusive use of the device.",
        intent === "voice"
          ? "Check your system sound input settings list a working microphone."
          : "If this device has no camera, start a voice call instead.",
      ],
    };
  }

  if (
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    name === "AbortError"
  ) {
    return {
      kind: "in-use",
      title: `Your ${devices(intent)} couldn't be started`,
      message: `Another app or browser tab is probably using your ${devices(intent)} right now.`,
      steps: [
        "Quit other video/voice apps (Zoom, Meet, Teams, FaceTime, OBS) and close other tabs using the camera.",
        "Then reload this page and start the call again.",
        "If it keeps failing, restarting the device clears a stuck capture device.",
      ],
    };
  }

  if (name === "SecurityError") {
    return {
      kind: "insecure",
      title: "A secure connection is required",
      message: `This page isn't allowed to use your ${devices(intent)} because the connection isn't secure or capture is disabled by policy.`,
      steps: [
        "Open https://melorimusic.org (not http://) and try again.",
        "If you're on a managed device, camera/microphone access may be disabled by an administrator policy.",
      ],
    };
  }

  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return {
      kind: "not-found",
      title: `No usable ${devices(intent)} found`,
      message: `No ${devices(intent)} on this device matched what the call needs.`,
      steps: [
        "Disconnect and reconnect the device, then try again.",
        "Try a voice call if the camera is unavailable.",
      ],
    };
  }

  return {
    kind: "unknown",
    title: `Couldn't start your ${devices(intent)}`,
    message: `Something stopped Melori from using your ${devices(intent)}.`,
    steps: [
      "Reload the page and try again.",
      `Check no other app is using your ${devices(intent)}.`,
      ...unblockSteps(intent).slice(0, 1),
    ],
  };
}

/** Single-line variant for compact surfaces (toasts, aria-live regions). */
export function captureErrorSummary(
  err: unknown,
  intent: CaptureIntent = "video",
): string {
  const info = formatCaptureError(err, intent);
  return `${info.title}. ${info.message}`;
}

/**
 * Guard for capture paths that do not call getUserMedia themselves — the
 * LiveKit SDK reaches for `navigator.mediaDevices` internally, so checking up
 * front is what keeps its TypeError off the screen.
 */
export function assertCaptureSupported(): void {
  const reason = getCaptureUnavailableReason();
  if (reason) {
    throw new MediaCaptureUnavailableError(
      reason,
      captureUnavailableMessage(reason),
    );
  }
}
