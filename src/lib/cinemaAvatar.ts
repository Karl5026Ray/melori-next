// src/lib/cinemaAvatar.ts
//
// MM Cinema rooms show initials on a colored circle for anyone
// without a profile photo, so a room full of new members reads as a crowd of
// distinct people rather than rows of identical grey discs. Karl picked this
// look from the Cinema prototype (1 Oct 2026): MM Social purple, teal, pink,
// amber, sky, lavender and emerald.
//
// Cinema's own copy: Spaces has src/lib/spacesAvatar.ts. The two rooms share
// no code (Karl, 2 Oct 2026), only this look.
//
// The color is derived from the person's id, never their display name, so it
// stays the same when they rename themselves and two "Chris"es still differ.

export const CINEMA_AVATAR_COLORS = [
  "#8b5cf6", // purple
  "#14b8a6", // teal
  "#ec4899", // pink
  "#f59e0b", // amber
  "#38bdf8", // sky
  "#a78bfa", // lavender
  "#10b981", // emerald
] as const;

export function cinemaAvatarColor(seed: string | null | undefined): string {
  const text = seed || "melori";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return CINEMA_AVATAR_COLORS[hash % CINEMA_AVATAR_COLORS.length];
}

/** Up to two initials: "Gloria Joy Rivers" -> "GJ", "kaiel_r" -> "K". */
export function cinemaInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
