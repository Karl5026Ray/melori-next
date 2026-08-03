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
