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
