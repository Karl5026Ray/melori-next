export function formatPrice(price: number | null | undefined): string {
  if (price == null) return "—";
  if (price === 0) return "Free";
  return `$${price.toFixed(2)}`;
}

// Integer-cent prices — the unit used by artist-set prices and Stripe. Kept
// separate from formatPrice (which takes DECIMAL dollars from the legacy
// `releases`/`tracks` columns) so the two units can never be silently mixed.
export function formatPriceCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Compact play counts: exact with separators below 10k ("1,234"), abbreviated
// above it ("12.3K", "1.2M") so a big number can't squeeze a track row's title.
export function formatCount(count: number | null | undefined): string {
  const n =
    typeof count === "number" && Number.isFinite(count)
      ? Math.max(0, Math.floor(count))
      : 0;
  if (n < 10_000) return n.toLocaleString("en-US");
  const [value, suffix] =
    n < 1_000_000 ? [n / 1_000, "K"] : [n / 1_000_000, "M"];
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${suffix}`;
}

// Like formatDuration but always returns a clock value (e.g. "0:00") — used by
// the player's current/total time readouts.
export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
