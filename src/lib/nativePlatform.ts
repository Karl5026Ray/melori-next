/** Appended to the WebView user agent by mobile/capacitor.config.json. */
export const NATIVE_UA_TOKEN = "MeloriApp";

export function isNativeUserAgent(ua: string | null | undefined): boolean {
  return typeof ua === "string" && ua.includes(NATIVE_UA_TOKEN);
}
