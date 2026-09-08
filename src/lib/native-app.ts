// src/lib/native-app.ts
//
// Detects whether the web app is running inside the Melori Music native
// Capacitor shell (iOS or Android) so purchase UI can be adapted at runtime.
//
// Detection strategy: Capacitor sets window.Capacitor on the global, and the
// app's User-Agent includes "org.melorimusic.app" (the Capacitor appId).
// Checking both gives a reliable signal — either is sufficient.
//
// IMPORTANT: client-only. Never import in a Server Component or API route.
// Use the useNativeApp hook in client components instead.

export type NativePlatform = "ios" | "android" | "web";

declare global {
  interface Window {
    Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
  }
}

/** Returns the runtime platform: "ios", "android", or "web". */
export function getNativePlatform(): NativePlatform {
  if (typeof window === "undefined") return "web";
  try {
    const cap = window.Capacitor;
    if (cap?.isNativePlatform?.()) {
      const p = cap.getPlatform?.();
      if (p === "ios") return "ios";
      if (p === "android") return "android";
    }
    // Fallback: UA check for the Capacitor WebView
    const ua = navigator.userAgent ?? "";
    if (ua.includes("org.melorimusic.app")) {
      if (/iPhone|iPad|iPod/.test(ua)) return "ios";
      return "android";
    }
  } catch {
    // Fail-open: treat as web if anything throws
  }
  return "web";
}

/** True when running inside the native iOS shell. */
export function isNativeIOS(): boolean {
  return getNativePlatform() === "ios";
}

/** True when running inside any Capacitor shell (iOS or Android). */
export function isNativeApp(): boolean {
  return getNativePlatform() !== "web";
}
