// src/lib/moderation.ts
//
// Content moderation via Cloudflare Workers AI (no OpenAI account required).
//   * TEXT  -> @cf/meta/llama-guard-3-8b  (Llama Guard 3, a purpose-built
//              safety classifier that returns "safe"/"unsafe" + violated
//              category codes S1..S13; S12 = Sexual Content).
//   * IMAGE -> @cf/llava-hf/llava-1.5-7b-hf (a vision-language model asked a
//              direct nudity/sexual yes/no + severity question). Cloudflare has
//              no dedicated NSFW image classifier, so this is a best-effort
//              vision check — obvious pornography is caught; borderline images
//              may pass to the user-report + admin backstop.
//   Docs: https://developers.cloudflare.com/workers-ai/models/llama-guard-3-8b/
//         https://developers.cloudflare.com/workers-ai/get-started/rest-api/
//
// POLICY (decided by the platform owner):
//   * Pornography / nudity          -> "quarantine"  (never public; admin review, default reject)
//   * Explicit music / borderline   -> "flag"         (stays visible; queued for admin review)
//   * Clean                         -> "clean"        (publishes normally)
//
// FAIL-SAFE: if CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN are not set, or the
//   API errors/times out, we return { decision: "clean", degraded: true }.
//   Content is NEVER blocked by a misconfiguration or outage — it just isn't
//   auto-screened until the credentials are set. The user-reporting + admin
//   tools remain the backstop in that window.

export type ModerationDecision = "clean" | "flag" | "quarantine";

export interface ModerationResult {
  decision: ModerationDecision;
  /** Human-readable reason, e.g. "sexual content (S12)". */
  reason: string | null;
  /** Raw model output, for the admin queue. */
  categories: Record<string, unknown> | null;
  /** True when moderation could not run (no creds / error) and we defaulted to clean. */
  degraded: boolean;
}

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const AI_TOKEN = process.env.CLOUDFLARE_AI_TOKEN ?? "";
const TEXT_MODEL = "@cf/meta/llama-guard-3-8b";
const VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";
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

// Fetch an image URL and convert to the byte array LLaVA expects.
async function fetchImageBytes(imageUrl: string): Promise<number[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Guard against very large payloads (LLaVA input limits + memory).
    if (buf.byteLength > 12 * 1024 * 1024) return null;
    return Array.from(new Uint8Array(buf));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseVisionResponse(text: string): ModerationResult {
  const raw = (text ?? "").trim();
  const upper = raw.toUpperCase();
  if (upper.includes("EXPLICIT")) {
    return {
      decision: "quarantine",
      reason: "nudity/sexual imagery — pornography",
      categories: { model: "llava-1.5-7b", raw },
      degraded: false,
    };
  }
  if (upper.includes("SUGGESTIVE")) {
    return {
      decision: "flag",
      reason: "sexually suggestive imagery",
      categories: { model: "llava-1.5-7b", raw },
      degraded: false,
    };
  }
  return CLEAN;
}

/**
 * Moderate an image by URL. Downloads the image and asks a vision-language
 * model for a nudity/sexual verdict. Best-effort — Cloudflare has no dedicated
 * NSFW classifier, so borderline images may pass to the report/admin backstop.
 */
export async function moderateImage(imageUrl: string): Promise<ModerationResult> {
  if (!imageUrl) return CLEAN;
  if (!textConfigured()) return CLEAN_DEGRADED;
  const bytes = await fetchImageBytes(imageUrl);
  if (!bytes) return CLEAN_DEGRADED;
  const result = await runModel(VISION_MODEL, {
    image: bytes,
    prompt: VISION_PROMPT,
    max_tokens: 24,
  });
  if (result == null) return CLEAN_DEGRADED;
  const responseText =
    typeof result === "string"
      ? result
      : ((result as { description?: string; response?: string }).description ??
        (result as { response?: string }).response ??
        "");
  return parseVisionResponse(responseText);
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
  // Return the most severe decision. quarantine > flag > clean.
  const rank = { clean: 0, flag: 1, quarantine: 2 } as const;
  const worst = rank[textRes.decision] >= rank[imageRes.decision] ? textRes : imageRes;
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
    default:
      return "clean";
  }
}

export function moderationEnabled(): boolean {
  return textConfigured();
}
