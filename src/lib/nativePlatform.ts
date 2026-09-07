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
  // Guideline 3.1.1, second finding on submission 6c0eeca5: "The app accesses
  // digital content purchased outside the app, such as Music, but that content
  // isn't available to purchase using In-App Purchase." Apple's own next step
  // cites 3.1.3(b), which permits access to content bought elsewhere ONLY if
  // the same content is also purchasable via IAP.
  //
  // Music sales stay on the web, so the answer is the other half of the rule:
  // the app does not access them at all. These are the post-purchase delivery
  // routes — they are the only surfaces that hand over a paid download. Free
  // 30-second previews and Superfan streaming are untouched; streaming is
  // covered by the subscription IAP rail instead.
  "/music/success",
  "/gallery/purchase",
  "/download-success",
] as const;

const BLOCKED_API_PATHS = [
  "/api/donate/checkout",
  "/api/music/checkout",
  "/api/store/checkout",
  "/api/gallery/checkout",
  "/api/gifts/checkout",
  "/api/booking/create",
  // Signed-URL delivery for content bought on the web. Blocking the pages
  // above is presentation; blocking these is what actually makes web-purchased
  // music and photo downloads unreachable inside the wrapper.
  "/api/music/download",
  "/api/gallery/download",
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
