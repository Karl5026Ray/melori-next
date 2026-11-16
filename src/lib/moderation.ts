// src/lib/moderation.ts
//
// Content moderation via Cloudflare Workers AI (no OpenAI account required).
//   * TEXT  -> @cf/meta/llama-guard-3-8b  (Llama Guard 3, a purpose-built
//              safety classifier that returns "safe"/"unsafe" + violated
//              category codes S1..S13; S12 = Sexual Content).
//   * IMAGE -> @cf/moondream/moondream3.1-9B-A2B (a vision-language model
//              asked a direct nudity/sexual severity question via its "query"
//              task). Cloudflare has no dedicated NSFW image classifier, so
//              this is a best-effort vision check — obvious pornography is
//              caught; borderline images may pass to the user-report + admin
//              backstop. (Replaced @cf/llava-hf/llava-1.5-7b-hf, which
//              Cloudflare retires on 2026-11-20.)
//   Docs: https://developers.cloudflare.com/workers-ai/models/llama-guard-3-8b/
//         https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/
//         https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/
//         https://developers.cloudflare.com/workers-ai/get-started/rest-api/
//
// POLICY (decided by the platform owner):
//   * Pornography / nudity          -> "quarantine"  (never public; admin review, default reject)
//   * Explicit music / borderline   -> "flag"         (stays visible; queued for admin review)
//   * Clean                         -> "clean"        (publishes normally)
//   * Image could not be screened   -> "review"       (held out of public view as
//                                                       'pending_review' until an
//                                                       admin approves it)
//
// FAILURE HANDLING:
//   * Credentials not set (local dev / misconfiguration): both text and images
//     return { decision: "clean", degraded: true } — nothing is auto-screened
//     until the credentials are set; /api/health reports the gap.
//   * TEXT: if the API errors/times out, text still fails OPEN (clean, degraded).
//   * IMAGES fail CLOSED: if the image can't be downloaded, is too large, the
//     model errors/times out (e.g. a retired model ID), or the answer can't be
//     parsed, the image is NOT marked clean. It comes back as "review" so the
//     caller holds it for admin review (or refuses it with a retry message
//     where there is no place to hold it). An outage must never let an
//     unchecked image go public.

import { readCloudflareCreds } from "@/lib/cloudflareCreds";

export type ModerationDecision = "clean" | "flag" | "review" | "quarantine";

/** Severity order, most severe last. "review" (hidden, awaiting an admin)
 *  outranks "flag" (visible, awaiting an admin). */
export const DECISION_RANK: Record<ModerationDecision, number> = {
  clean: 0,
  flag: 1,
  review: 2,
  quarantine: 3,
};

export interface ModerationResult {
  decision: ModerationDecision;
  /** Human-readable reason, e.g. "sexual content (S12)". */
  reason: string | null;
  /** Raw model output, for the admin queue. */
  categories: Record<string, unknown> | null;
  /** True when moderation could not run (no creds / error). For text this
   *  means it defaulted to clean; for images it means "review" (held). */
  degraded: boolean;
}

// Normalised by readCloudflareCreds (strips pasted quotes, backticks, spaces
// and a leading "Bearer "). See src/lib/cloudflareCreds.ts for why.
const { accountId: ACCOUNT_ID, token: AI_TOKEN } = readCloudflareCreds(process.env);
export const TEXT_MODEL = "@cf/meta/llama-guard-3-8b";
export const VISION_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const TIMEOUT_MS = 8000;

// Llama Guard 3 hazard categories (MLCommons taxonomy). S12 = Sexual Content,
// S4 = Child Sexual Exploitation. We quarantine sexual categories (owner's #1
// concern) and flag the rest of the unsafe categories for admin review.
const QUARANTINE_TEXT_CODES = new Set(["S4", "S12"]);
const CODE_LABELS: Record<string, string> = {
  S1: "violent crimes",
  S2: "non-violent crimes",
  S3: "sex crimes",
  S4: "child sexual exploitation",
  S5: "defamation",
  S6: "specialized advice",
  S7: "privacy",
  S8: "intellectual property",
  S9: "indiscriminate weapons",
  S10: "hate",
  S11: "self-harm",
  S12: "sexual content",
  S13: "elections",
};

function textConfigured(): boolean {
  return Boolean(ACCOUNT_ID && AI_TOKEN);
}

const CLEAN: ModerationResult = {
  decision: "clean",
  reason: null,
  categories: null,
  degraded: false,
};
const CLEAN_DEGRADED: ModerationResult = {
  decision: "clean",
  reason: null,
  categories: null,
  degraded: true,
};

/** An image that could not be screened. Never treated as clean. */
function heldForReview(why: string): ModerationResult {
  return {
    decision: "review",
    reason: `automated image screening unavailable (${why}) — held for admin review`,
    categories: { model: VISION_MODEL, error: why },
    degraded: true,
  };
}

async function runModel(model: string, body: unknown): Promise<unknown | null> {
  if (!textConfigured()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_TOKEN}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.error(
        "[moderation] Cloudflare error",
        res.status,
        await res.text().catch(() => ""),
      );
      return null;
    }
    const json = (await res.json()) as { result?: unknown; success?: boolean };
    return json.result ?? null;
  } catch (err) {
    console.error("[moderation] Cloudflare request failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Llama Guard 3 emits text like:
//   "safe"                      -> clean
//   "unsafe\nS12"               -> unsafe, sexual content
//   "unsafe\nS1,S12"            -> multiple categories
function parseGuardResponse(text: string): ModerationResult {
  const raw = (text ?? "").trim();
  const lower = raw.toLowerCase();
  if (!raw || lower.startsWith("safe")) return CLEAN;

  // Collect any S-codes mentioned anywhere in the response.
  const codes = Array.from(
    new Set((raw.toUpperCase().match(/S1[0-3]|S[1-9]/g) ?? [])),
  );
  const hasQuarantine = codes.some((c) => QUARANTINE_TEXT_CODES.has(c));
  const labels = codes.map((c) => `${CODE_LABELS[c] ?? c} (${c})`).join(", ");

  if (hasQuarantine) {
    return {
      decision: "quarantine",
      reason: `${labels || "sexual content"} — pornography/sexual`,
      categories: { model: "llama-guard-3-8b", raw, codes },
      degraded: false,
    };
  }
  // Unsafe but not sexual -> flag for admin review (stays visible).
  return {
    decision: "flag",
    reason: labels || "unsafe content",
    categories: { model: "llama-guard-3-8b", raw, codes },
    degraded: false,
  };
}

/** Moderate a piece of text. Returns clean+degraded if the API is unavailable. */
export async function moderateText(text: string): Promise<ModerationResult> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return CLEAN;
  const result = await runModel(TEXT_MODEL, {
    messages: [{ role: "user", content: trimmed }],
  });
  if (result == null) return CLEAN_DEGRADED;
  // Llama Guard returns { response: "safe" | "unsafe\nS12..." }.
  const responseText =
    typeof result === "string"
      ? result
      : ((result as { response?: string }).response ?? "");
  return parseGuardResponse(responseText);
}

const VISION_PROMPT =
  "You are a strict content-safety classifier. Look at this image and answer in EXACTLY this format on one line: " +
  'VERDICT=<CLEAN|SUGGESTIVE|EXPLICIT>. ' +
  "Use EXPLICIT if the image contains nudity, exposed genitals/breasts/buttocks, or any sexual/pornographic act. " +
  "Use SUGGESTIVE if it is sexually suggestive, in underwear/lingerie/swimwear in a provocative way, but not nude. " +
  "Use CLEAN otherwise. Output only the VERDICT line.";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

// Fetch an image URL and convert it to the base64 data URI Moondream accepts.
// (We download it ourselves rather than handing Cloudflare the URL so private,
// short-lived signed URLs and the size guard behave the same everywhere.)
async function fetchImageDataUri(imageUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Guard against very large payloads (model input limits + memory).
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
    const rawType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const mime = rawType.startsWith("image/") ? rawType : "image/jpeg";
    return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseVisionResponse(text: string): ModerationResult {
  const raw = (text ?? "").trim();
  const upper = raw.toUpperCase();
  if (upper.includes("EXPLICIT")) {
    return {
      decision: "quarantine",
      reason: "nudity/sexual imagery — pornography",
      categories: { model: VISION_MODEL, raw },
      degraded: false,
    };
  }
  if (upper.includes("SUGGESTIVE")) {
    return {
      decision: "flag",
      reason: "sexually suggestive imagery",
      categories: { model: VISION_MODEL, raw },
      degraded: false,
    };
  }
  if (upper.includes("CLEAN")) return CLEAN;
  // Empty or off-format answer: we don't know what the image is, so hold it.
  return heldForReview(raw ? "unrecognised model answer" : "empty model answer");
}

/**
 * Moderate an image by URL. Downloads the image and asks a vision-language
 * model for a nudity/sexual verdict. Best-effort — Cloudflare has no dedicated
 * NSFW classifier, so borderline images may pass to the report/admin backstop.
 *
 * Fails CLOSED: any failure to screen returns decision "review", never "clean".
 */
export async function moderateImage(imageUrl: string): Promise<ModerationResult> {
  if (!imageUrl) return CLEAN;
  if (!textConfigured()) return CLEAN_DEGRADED;
  const dataUri = await fetchImageDataUri(imageUrl);
  if (!dataUri) return heldForReview("image could not be downloaded or is too large");
  // Moondream "query" task: input { task, image, question, reasoning,
  // max_tokens }, output { answer, ... }.
  const result = await runModel(VISION_MODEL, {
    task: "query",
    image: dataUri,
    question: VISION_PROMPT,
    reasoning: false,
    temperature: 0,
    max_tokens: 24,
  });
  if (result == null) return heldForReview("model request failed");
  const responseText =
    typeof result === "string"
      ? result
      : ((result as { answer?: string | null }).answer ??
        (result as { response?: string }).response ??
        "");
  return parseVisionResponse(responseText ?? "");
}

/** Moderate combined text + image (e.g. a post with a caption + photo). */
export async function moderateTextAndImage(
  text: string,
  imageUrl: string,
): Promise<ModerationResult> {
  const [textRes, imageRes] = await Promise.all([
    text?.trim() ? moderateText(text) : Promise.resolve(CLEAN),
    imageUrl ? moderateImage(imageUrl) : Promise.resolve(CLEAN),
  ]);
  // Return the most severe decision. quarantine > review > flag > clean.
  const worst =
    DECISION_RANK[textRes.decision] >= DECISION_RANK[imageRes.decision] ? textRes : imageRes;
  // Preserve a degraded flag if either channel silently failed.
  if (worst.decision === "clean" && (textRes.degraded || imageRes.degraded)) {
    return CLEAN_DEGRADED;
  }
  return worst;
}

/** Map a decision to the moderation_status column value used across content tables. */
export function statusForDecision(decision: ModerationDecision): string {
  switch (decision) {
    case "quarantine":
      return "quarantined";
    case "flag":
      return "flagged";
    case "review":
      return "pending_review";
    default:
      return "clean";
  }
}

export function moderationEnabled(): boolean {
  return textConfigured();
}
