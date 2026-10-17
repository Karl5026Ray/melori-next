// One link for the Melori app on any phone: melorimusic.org/app.
//
// Karl, 2026-10-17: people who only have the website rarely come back, so
// flyers, cards and QR codes point at /app and each phone is sent to its own
// store. The printed code never changes — when Android goes public, flip
// ANDROID_ON_PLAY_STORE and every flyer already out starts landing on Play.

import { PLAY_INSTALL_URL, isAndroidWebUserAgent, isIPhoneUserAgent } from "@/lib/androidBeta";

/** Melori Music on the App Store (live; seller Karl Ray). Region-neutral link. */
export const APP_STORE_URL = "https://apps.apple.com/app/id6792791603";

/**
 * Android is in closed testing (2026-10-17), so Play has no public listing yet.
 * Until it does, Android phones go to the beta-tester signup instead.
 */
export const ANDROID_ON_PLAY_STORE = false;
export const ANDROID_BETA_PATH = "/android?src=qr";

/** Where /app sends this visitor. Relative paths stay on melorimusic.org. */
export function appLinkTarget(userAgent: string | null | undefined): string {
  if (isIPhoneUserAgent(userAgent)) return APP_STORE_URL;
  if (isAndroidWebUserAgent(userAgent)) {
    return ANDROID_ON_PLAY_STORE ? PLAY_INSTALL_URL : ANDROID_BETA_PATH;
  }
  return "/";
}
