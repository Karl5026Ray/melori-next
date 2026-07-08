// track-cleanup — post-upload moderation hook (publish-first).
//
// Invoked ASYNCHRONOUSLY by a Supabase Database Webhook on INSERT INTO public.tracks.
// The track is ALREADY live when this runs, so nothing here blocks the upload or
// the artist experience. It can only *subtract* visibility (flag/remove) by setting
// moderation_status — it never touches is_published, so the artist keeps their work
// and restoration is a one-field revert.
//
// Verdicts:
//   clean          -> no-op, track stays live
//   pending_review -> soft flag; stays live but queued for a human (track_submissions='reported')
//   removed        -> hard takedown; hidden from public immediately via RLS + API filter
//
// Every non-clean action writes public.audit_logs and pings Vercel to revalidate
// so a removed track disappears from cached pages right away.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type TrackRow = {
  id: number;
  title: string | null;
  audio_url: string | null;
  release_id: number | null;
};

// Minimal, cheap first-pass checks. Swap scanTrack() internals for a real
// audio-fingerprint / copyright / ML service later without changing the contract.
const BANNED_PATTERNS: RegExp[] = [
  /\b(n[i1]gg|f[a@]gg|k[i1]ke)\w*/i, // slur stems (illustrative)
];

function scanTitle(title: string | null): "clean" | "pending_review" | "removed" {
  if (!title) return "clean";
  for (const re of BANNED_PATTERNS) {
    if (re.test(title)) return "removed";
  }
  // Heuristics that merely warrant a human look:
  if (/(leak|unreleased|\bdemo steal\b)/i.test(title)) return "pending_review";
  return "clean";
}

async function scanTrack(track: TrackRow): Promise<"clean" | "pending_review" | "removed"> {
  // 1) text checks on title (and description if you fetch it)
  const titleVerdict = scanTitle(track.title);
  if (titleVerdict !== "clean") return titleVerdict;
  // 2) integrity: a live track must have a real audio_url
  if (!track.audio_url) return "pending_review";
  // 3) TODO: audio fingerprint / duplicate / copyright service call here.
  return "clean";
}

Deno.serve(async (req: Request) => {
  // Shared-secret gate (webhook sets this header). verify_jwt is disabled for
  // this function because Supabase DB webhooks don't send a user JWT.
  const secret = req.headers.get("x-cleanup-secret");
  if (!secret || secret !== Deno.env.get("CLEANUP_WEBHOOK_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: { type?: string; record?: TrackRow };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const track = payload.record;
  if (!track?.id) return new Response("no record", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const verdict = await scanTrack(track);
  if (verdict === "clean") {
    return new Response(JSON.stringify({ track_id: track.id, verdict }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const reason =
    verdict === "removed"
      ? "auto: policy violation detected in title"
      : "auto: flagged for human review";

  // Subtractive moderation — never touches is_published.
  const { error: upErr } = await supabase
    .from("tracks")
    .update({
      moderation_status: verdict,
      moderation_reason: reason,
      moderated_at: new Date().toISOString(),
      // moderated_by left null == system/automated actor
    })
    .eq("id", track.id);
  if (upErr) console.error("moderation update failed:", upErr);

  // Audit trail (reuses existing public.audit_logs table).
  await supabase.from("audit_logs").insert({
    action: "track_moderation",
    table_name: "tracks",
    record_id: track.id,
    new_data: { moderation_status: verdict, moderation_reason: reason },
  });

  // Queue for a human when flagged (keeps track_submissions as the review log).
  if (verdict === "pending_review") {
    await supabase.from("track_submissions").update({ status: "reported" })
      .eq("approved_track_id", track.id);
  }

  // Tell Vercel to revalidate so a removed track drops out of cached pages now.
  const revalidateUrl = Deno.env.get("VERCEL_REVALIDATE_URL");
  if (revalidateUrl && verdict === "removed") {
    try {
      await fetch(`${revalidateUrl}?track=${track.id}`, {
        method: "POST",
        headers: { authorization: `Bearer ${Deno.env.get("REVALIDATE_SECRET") ?? ""}` },
      });
    } catch (e) {
      console.error("revalidate ping failed:", e);
    }
  }

  return new Response(JSON.stringify({ track_id: track.id, verdict, reason }), {
    headers: { "Content-Type": "application/json" },
  });
});
