// URL-safe slug from a human name, matching the store's slug conventions. Lives
// in its own module so client components can use it without pulling in the
// server-only helpers of @/lib/gallery-auth.
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
