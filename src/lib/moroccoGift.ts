// Shared rules for the optional Morocco gift-address form (/morocco/thank-you).
// Used by the client form and POST /api/morocco/gift-address. See migration 104.

// The album gift: $10 gets RELAUNCH, $20+ gets all three albums from Karl's label. Each link is an
// anyone-with-the-link Google Drive folder Karl owns (checked Nov 21, 2026).
export type MoroccoAlbum = {
  title: string;
  artist: string;
  cover: string;
  url: string;
};

export const MOROCCO_ALBUMS: MoroccoAlbum[] = [
  {
    title: "RELAUNCH",
    artist: "Karl Ray",
    cover: "/morocco-photos/cover-relaunch.webp",
    url: "https://drive.google.com/drive/folders/15aI4u3YMsilRGhdcg6ED4EwPP448_FJY?usp=sharing",
  },
  {
    title: "Milk & Honey",
    artist: "Kaiel R",
    cover: "/morocco-photos/cover-milk-and-honey.webp",
    url: "https://drive.google.com/drive/folders/1WlGqKYlN6YigoaDz74zpzxfPu_N2TFZm?usp=sharing",
  },
  {
    title: "Walls Come Down",
    artist: "Gloria Joy Rivers",
    cover: "/morocco-photos/cover-walls-come-down.webp",
    url: "https://drive.google.com/drive/folders/1l69WqeApeaNw_CRm2C0-u7mr5JUWJP4I?usp=sharing",
  },
];

export type MoroccoTier = "10" | "20" | "50" | "100" | "custom";
const TIERS: MoroccoTier[] = ["10", "20", "50", "100", "custom"];

export function parseTier(raw: unknown): MoroccoTier | null {
  return typeof raw === "string" && (TIERS as string[]).includes(raw) ? (raw as MoroccoTier) : null;
}

/** What the supporter is owed, by tier. "custom" = the slider link (any amount). */
export function tierGifts(tier: MoroccoTier | null) {
  return {
    album: true,
    // $10 gets RELAUNCH only; every other tier gets all three albums.
    albums: tier === "10" ? MOROCCO_ALBUMS.slice(0, 1) : MOROCCO_ALBUMS,
    mailed: tier === "50" || tier === "100" || tier === "custom",
    hardcover: tier === "100",
  };
}

const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
export function isSessionId(raw: unknown): raw is string {
  return typeof raw === "string" && SESSION_RE.test(raw);
}

export type GiftAddressInput = {
  stripe_session_id: string;
  tier: MoroccoTier | null;
  full_name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: "US" | "CA";
  note: string | null;
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function validateGiftAddress(
  body: unknown,
): { ok: true; value: GiftAddressInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isSessionId(b.stripe_session_id)) {
    return { ok: false, error: "We couldn't match this to your gift. Please use the link from your payment." };
  }
  const value: GiftAddressInput = {
    stripe_session_id: b.stripe_session_id,
    tier: parseTier(b.tier),
    full_name: str(b.full_name, 100),
    line1: str(b.line1, 200),
    line2: str(b.line2, 200) || null,
    city: str(b.city, 100),
    state: str(b.state, 60),
    postal_code: str(b.postal_code, 20),
    country: b.country === "CA" ? "CA" : "US",
    note: str(b.note, 500) || null,
  };
  if (!value.full_name) return { ok: false, error: "Please add the name to mail it to." };
  if (!value.line1) return { ok: false, error: "Please add a street address." };
  if (!value.city) return { ok: false, error: "Please add a city." };
  if (!value.state) return { ok: false, error: "Please add a state or province." };
  if (value.postal_code.length < 2) return { ok: false, error: "Please add a ZIP or postal code." };
  return { ok: true, value };
}
