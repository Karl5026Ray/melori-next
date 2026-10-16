// Pure helpers for search-result descriptions, kept out of the server-only
// module so scripts/seo-text.test.ts can import them.

export const SEO_MAX_CHARS = 160;

/** Normalize model output into a safe meta description, or null. */
export function cleanSeoText(raw: string): string | null {
  let text = raw.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!text || /[<>{}#*`]/.test(text)) return null;
  if (text.length > SEO_MAX_CHARS) {
    const cut = text.slice(0, SEO_MAX_CHARS - 1);
    const lastSpace = cut.lastIndexOf(" ");
    text = `${cut.slice(0, lastSpace > 80 ? lastSpace : cut.length).replace(/[,;:\s]+$/, "")}…`;
  }
  return text.length >= 30 ? text : null;
}
