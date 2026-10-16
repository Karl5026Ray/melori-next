// Pure helpers for search-result descriptions, kept out of the server-only
// module so scripts/seo-public-albums.test.ts can import them.

export const SEO_MAX_CHARS = 160;

// The first production run (2026-10-16) wrote one description with the model's
// own aside on the end: "...on MELORI Music. Hmm, that repeats the platform
// name…". A meta description is ONE sentence, so anything after the first
// sentence is dropped, and output that reads as the model talking to itself is
// rejected outright.
const META_TALK = /\b(hmm|let me|i think|i'll|i will|here is|here's|note:|that repeats)\b/i;

/** Normalize model output into a safe meta description, or null. */
export function cleanSeoText(raw: string): string | null {
  let text = raw.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!text || /[<>{}#*`]/.test(text)) return null;
  if (META_TALK.test(text)) {
    // Keep the first sentence only if the aside came after it.
    const first = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? "";
    if (!first || META_TALK.test(first)) return null;
    text = first;
  }
  // A lone straight quote (e.g. 'features the title "We're Here.') reads as
  // broken in a search result; drop it rather than guess where it closes.
  if ((text.match(/"/g) ?? []).length % 2 === 1) text = text.replace(/"/g, "");
  if (text.length > SEO_MAX_CHARS) {
    const cut = text.slice(0, SEO_MAX_CHARS - 1);
    const lastSpace = cut.lastIndexOf(" ");
    text = `${cut.slice(0, lastSpace > 80 ? lastSpace : cut.length).replace(/[,;:\s]+$/, "")}…`;
  }
  return text.length >= 30 ? text : null;
}
