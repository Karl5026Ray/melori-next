// Shared price rules for artist-set pricing. Imported by the Studio forms
// (client) and by the studio APIs (server) so the browser and the database
// agree on what a legal price is — the server still re-validates, because the
// client copy is only a convenience.

// Singles sit at $1.99, not $0.99: Stripe's flat $0.30 per transaction eats
// roughly a third of a $0.99 sale, which is incompatible with promising the
// artist everything after processing. At $1.99 the artist nets ~82%.
export const DEFAULT_SINGLE_PRICE_CENTS = 199;
export const DEFAULT_ALBUM_PRICE_CENTS = 999;

// Matches the CHECK constraint in migration 045. Zero is legal and means
// "free" — the catalog renders Play/Download instead of Buy.
export const MIN_PRICE_CENTS = 0;
export const MAX_PRICE_CENTS = 99_999_999;

export const PRICE_RANGE_MESSAGE =
  "Price must be between $0.00 (free) and $999,999.99.";

/** Parse a price submitted as cents. Returns null when it isn't usable. */
export function parsePriceCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < MIN_PRICE_CENTS || n > MAX_PRICE_CENTS) return null;
  return n;
}

/** Parse a dollars string from a form input into whole cents. */
export function dollarsToCentsInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d*(\.\d{0,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isFinite(cents)) return null;
  if (cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) return null;
  return cents;
}

export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}
