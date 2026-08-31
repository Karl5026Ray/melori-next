/** Appended to the WebView user agent by mobile/capacitor.config.json. */
export const NATIVE_UA_TOKEN = "MeloriApp";

/** Neutral destination for a native request at a commerce route. */
export const NATIVE_INFO_PATH = "/account-info";

export function isNativeUserAgent(ua: string | null | undefined): boolean {
  return typeof ua === "string" && ua.includes(NATIVE_UA_TOKEN);
}

const BLOCKED_PAGE_PREFIXES = [
  "/donate",
  "/checkout",
  "/cart",
  "/store",
  "/pricing",
  "/book",
  "/membership",
] as const;

const BLOCKED_API_PATHS = [
  "/api/donate/checkout",
  "/api/music/checkout",
  "/api/store/checkout",
  "/api/gallery/checkout",
  "/api/gifts/checkout",
  "/api/booking/create",
] as const;

const PAID_TIERS = new Set(["artist", "superfan", "snappd"]);

export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isBlockedNativeApi(pathname: string): boolean {
  return BLOCKED_API_PATHS.some((path) => matchesPrefix(pathname, path));
}

export function isBlockedNativePage(
  pathname: string,
  tier?: string | null,
): boolean {
  if (BLOCKED_PAGE_PREFIXES.some((path) => matchesPrefix(pathname, path))) {
    return true;
  }

  return matchesPrefix(pathname, "/register") && !!tier && PAID_TIERS.has(tier);
}
