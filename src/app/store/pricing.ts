import type { StoreProduct } from "@/types";

// Resolved price in cents (sale price wins when present).
export function resolvedPrice(p: Pick<StoreProduct, "price" | "sale_price">) {
  return p.sale_price ?? p.price;
}

// Format integer cents as a display string, e.g. 3500 -> "$35.00".
export function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// Percentage discount for the sale badge, e.g. -20%.
export function discountPercent(
  p: Pick<StoreProduct, "price" | "sale_price">
) {
  if (!p.sale_price || p.sale_price >= p.price) return 0;
  return Math.round((1 - p.sale_price / p.price) * 100);
}
