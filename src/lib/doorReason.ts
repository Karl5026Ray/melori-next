// Why a signed-out visitor was sent to the door, when the proxy knows.
//
// src/proxy.ts TEASER_FOR sends some gated paths to `/platform?reason=<key>`
// (today only /social/messages → `chat`). The door shows the matching line
// above the signup form. Only keys listed here are ever shown — anything else
// in `?reason=` is ignored, so the door never echoes arbitrary text from a URL.

const DOOR_REASONS: Record<string, string> = {
  chat: "Sign in to see your messages.",
};

/** The one-line explanation for a `?reason=` query string, or null. */
export function doorReason(search: string): string | null {
  const reason = new URLSearchParams(search).get("reason");
  if (!reason || !Object.hasOwn(DOOR_REASONS, reason)) return null;
  return DOOR_REASONS[reason] ?? null;
}
