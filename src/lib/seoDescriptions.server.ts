import "server-only";
import { cleanSeoText, SEO_MAX_CHARS } from "@/lib/seoText";

// Search-result descriptions for public artist and album pages.
//
// WHY: Google shows the <meta name="description"> under each result. 23 of 25
// artists and 72 of 81 releases had nothing better than "Listen to X on MELORI
// Music." (2026-10-15). Karl's Max plan includes a monthly Claude API credit;
// this spends a sliver of it turning facts already on each page into one
// honest sentence.
//
// RULES THE PROMPT ENFORCES, AND WHY
// • Facts only. These are real artists. An invented hometown, award or "chart-
//   topping" is a false statement published under their name. The model gets
//   the page's own facts and nothing else, and is told to add nothing.
// • Separate column. The artist's bio and the release description are their
//   own words and render on the page; this text never replaces them.
// • Fails closed. Any API or validation problem returns null and the page
//   keeps its existing fallback description. Nothing user-facing breaks.

const API_URL = "https://api.anthropic.com/v1/messages";
// Haiku: a 160-character sentence does not need a bigger model, and the
// cheapest one makes the monthly credit last.
const DEFAULT_MODEL = "claude-haiku-5-5";

export interface SeoFacts {
  kind: "artist" | "album";
  name: string;
  /** For albums: the performing artist. */
  artist?: string | null;
  genre?: string | null;
  releaseType?: string | null;
  year?: string | null;
  /** The subject's own words (bio / description), if any. */
  ownWords?: string | null;
  /** Release or track titles shown on the page. */
  titles?: string[];
}

const SYSTEM = [
  "You write the meta description a search engine shows under a link to a page on MELORI Music, an independent music platform.",
  `Write ONE plain sentence, at most ${SEO_MAX_CHARS - 10} characters.`,
  "Use ONLY the facts provided. Do not add hometowns, influences, awards, chart positions, follower counts, comparisons, or any detail not in the facts.",
  "No hype words (best, iconic, legendary, chart-topping). No quotes, emoji, hashtags or markdown.",
  "Mention the name, and the artist for an album. Ending with 'on MELORI Music' is good when it fits.",
  "Reply with the sentence only.",
].join(" ");

function factsToText(f: SeoFacts): string {
  const lines = [`Page type: ${f.kind}`, `Name: ${f.name}`];
  if (f.artist) lines.push(`Artist: ${f.artist}`);
  if (f.releaseType) lines.push(`Release type: ${f.releaseType}`);
  if (f.genre) lines.push(`Genre: ${f.genre}`);
  if (f.year) lines.push(`Year: ${f.year}`);
  if (f.titles?.length) lines.push(`Titles on the page: ${f.titles.slice(0, 12).join("; ")}`);
  if (f.ownWords?.trim()) lines.push(`Their own description: ${f.ownWords.trim().slice(0, 1200)}`);
  return lines.join("\n");
}

export type SeoResult =
  | { ok: true; text: string; inputTokens: number; outputTokens: number }
  | { ok: false; error: string };

export async function generateSeoDescription(facts: SeoFacts): Promise<SeoResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !key.startsWith("sk-ant-")) {
    return { ok: false, error: "ANTHROPIC_API_KEY missing or still the placeholder" };
  }
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.SEO_MODEL || DEFAULT_MODEL,
        max_tokens: 120,
        system: SYSTEM,
        messages: [{ role: "user", content: factsToText(facts) }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Claude API ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const raw = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ");
    const text = cleanSeoText(raw);
    if (!text) return { ok: false, error: `unusable output: ${raw.slice(0, 120)}` };
    return {
      ok: true,
      text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
