// src/lib/moderation.ts
//
// Content moderation via OpenAI's free Moderation endpoint (omni-moderation-latest).
// Text AND image inputs are supported and the endpoint is free for API users
// (see https://platform.openai.com/docs/guides/moderation).
//
// POLICY (decided by the platform owner):
//   * Pornography / nudity          -> "quarantine"  (never public; admin review, default reject)
//   * Explicit music / borderline   -> "flag"         (stays visible; queued for admin review)
//   * Clean                         -> "clean"        (publishes normally)
//
// IMPORTANT MODEL LIMITATION (verified against OpenAI docs, July 2026):
//   For IMAGE inputs, omni-moderation only scores six categories — sexual,
//   sexual/minors is NOT image-supported, violence, violence/graphic, self-harm*.
//   Hate/harassment/illicit are TEXT ONLY. So image moderation is strongest at
//   catching porn/nudity (the owner's #1 concern) and graphic violence.
//
// FAIL-SAFE: if OPENAI_API_KEY is not set, or the API errors/times out, we return
//   { decision: "clean", degraded: true }. Content is NEVER blocked by a
//   misconfiguration or outage — it just isn't auto-screened until the key is set.
//   The user-reporting + admin tools remain the backstop in that window.

export type ModerationDecision = "clean" | "flag" | "quarantine";

export interface ModerationResult {
  decision: ModerationDecision;
  /** Human-readable reason, e.g. "sexual (0.97)". */
  reason: string | null;
  /** Raw per-category flags/scores from the model, for the admin queue. */
  categories: Record<string, unknown> | null;
  /** True when moderation could not run (no key / error) and we defaulted to clean. */
  degraded: boolean;
}

const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";
const MODEL = "omni-moderation-latest";

// Score thresholds. Sexual content at/above QUARANTINE_SEXUAL is treated as
// pornography/nudity and hard-blocked. Between FLAG and QUARANTINE it's treated
// as "explicit/borderline" and flagged for review. Tuned conservatively: the
// owner would rather over-quarantine porn than let it through.
const QUARANTINE_SEXUAL = 0.7; // porn / nudity
const FLAG_SEXUAL = 0.35; // suggestive / borderline
// Any of these flagged categories (binary) route to "flag" for admin review.
const FLAG_CATEGORIES = [
  "hate",
  "hate/threatening",
  "harassment",
  "harassment/threatening",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "violence",
  "violence/graphic",
  "illicit",
  "illicit/violent",
];
// Categories that ALWAYS hard-quarantine regardless of score when flagged.
const QUARANTINE_CATEGORIES = ["sexual/minors"];

type OpenAIModerationResult = {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
};

function isConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function callOpenAI(
  input: unknown,
): Promise<OpenAIModerationResult | null> {
  if (!isConfigured()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(OPENAI_MODERATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, input }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[moderation] OpenAI error", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = (await res.json()) as { results?: OpenAIModerationResult[] };
    return json.results?.[0] ?? null;
  } catch (err) {
    console.error("[moderation] OpenAI request failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function decide(result: OpenAIModerationResult): ModerationResult {
  const scores = result.category_scores ?? {};
  const cats = result.categories ?? {};

  // 1. Hard quarantine: sexual/minors flagged, or sexual score >= porn threshold.
  for (const c of QUARANTINE_CATEGORIES) {
    if (cats[c]) {
      return {
        decision: "quarantine",
        reason: `${c} (${(scores[c] ?? 1).toFixed(2)})`,
        categories: { flagged: cats, scores },
        degraded: false,
      };
    }
  }
  const sexual = Math.max(scores["sexual"] ?? 0, scores["sexual/minors"] ?? 0);
  if (sexual >= QUARANTINE_SEXUAL) {
    return {
      decision: "quarantine",
      reason: `sexual (${sexual.toFixed(2)}) — pornography/nudity`,
      categories: { flagged: cats, scores },
      degraded: false,
    };
  }

  // 2. Flag for review: borderline sexual, or any other harmful category flagged.
  if (sexual >= FLAG_SEXUAL) {
    return {
      decision: "flag",
      reason: `sexual (${sexual.toFixed(2)}) — explicit/borderline`,
      categories: { flagged: cats, scores },
      degraded: false,
    };
  }
  for (const c of FLAG_CATEGORIES) {
    if (cats[c]) {
      return {
        decision: "flag",
        reason: `${c} (${(scores[c] ?? 1).toFixed(2)})`,
        categories: { flagged: cats, scores },
        degraded: false,
      };
    }
  }

  return { decision: "clean", reason: null, categories: { flagged: cats, scores }, degraded: false };
}

const CLEAN_DEGRADED: ModerationResult = {
  decision: "clean",
  reason: null,
  categories: null,
  degraded: true,
};

/** Moderate a piece of text. Returns clean+degraded if the API is unavailable. */
export async function moderateText(text: string): Promise<ModerationResult> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { decision: "clean", reason: null, categories: null, degraded: false };
  const result = await callOpenAI(trimmed);
  if (!result) return CLEAN_DEGRADED;
  return decide(result);
}

/**
 * Moderate an image by URL (must be publicly reachable, e.g. a Supabase public
 * bucket URL). For images, only sexual/violence/self-harm categories are scored.
 */
export async function moderateImage(imageUrl: string): Promise<ModerationResult> {
  if (!imageUrl) return { decision: "clean", reason: null, categories: null, degraded: false };
  const result = await callOpenAI([
    { type: "image_url", image_url: { url: imageUrl } },
  ]);
  if (!result) return CLEAN_DEGRADED;
  return decide(result);
}

/** Moderate combined text + image in one call (e.g. a post with a caption). */
export async function moderateTextAndImage(
  text: string,
  imageUrl: string,
): Promise<ModerationResult> {
  const input: unknown[] = [];
  if (text?.trim()) input.push({ type: "text", text: text.trim() });
  if (imageUrl) input.push({ type: "image_url", image_url: { url: imageUrl } });
  if (input.length === 0)
    return { decision: "clean", reason: null, categories: null, degraded: false };
  const result = await callOpenAI(input);
  if (!result) return CLEAN_DEGRADED;
  return decide(result);
}

/** Map a decision to the moderation_status column value used across content tables. */
export function statusForDecision(decision: ModerationDecision): string {
  switch (decision) {
    case "quarantine":
      return "quarantined";
    case "flag":
      return "flagged";
    default:
      return "clean";
  }
}

export function moderationEnabled(): boolean {
  return isConfigured();
}
