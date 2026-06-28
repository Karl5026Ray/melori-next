export function formatPrice(price: number | null | undefined): string {
  if (price == null) return "—";
  if (price === 0) return "Free";
  return `$${price.toFixed(2)}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Like formatDuration but always returns a clock value (e.g. "0:00") — used by
// the player's current/total time readouts.
export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
