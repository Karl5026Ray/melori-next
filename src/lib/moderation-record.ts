// src/lib/moderation-record.ts
//
// Server-side helper to record an auto-moderation decision into the
// content_moderation queue. Always uses the service-role client. Best-effort:
// never throws into the caller's request path (a logging failure must not block
// or fail a user action).

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ModerationResult } from "@/lib/moderation";

export type ModeratedContentType =
  | "message"
  | "comment"
  | "gallery"
  | "bio"
  | "avatar"
  | "banner"
  | "video"
  | "track";

export async function recordModeration(opts: {
  contentType: ModeratedContentType;
  contentId?: string | null;
  authorId?: string | null;
  result: ModerationResult;
  mediaUrl?: string | null;
  excerpt?: string | null;
}): Promise<void> {
  const { result } = opts;
  // Only quarantine/flag decisions are queued. Clean content is not logged.
  if (result.decision === "clean") return;
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("content_moderation").insert({
      content_type: opts.contentType,
      content_id: opts.contentId ?? null,
      author_id: opts.authorId ?? null,
      decision: result.decision === "quarantine" ? "quarantined" : "flagged",
      reason: result.reason,
      categories: result.categories,
      media_url: opts.mediaUrl ?? null,
      excerpt: opts.excerpt ? opts.excerpt.slice(0, 280) : null,
    });
  } catch (err) {
    console.error("[moderation] failed to record decision:", err);
  }
}
