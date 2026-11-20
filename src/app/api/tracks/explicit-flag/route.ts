import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { getSupabaseAdmin, PUBLIC_CATALOG_TAG } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import {
  EXPLICIT_REPORT_TYPE,
  autoMarkThreshold,
  getFlaggableTrack,
  parseTrackRef,
  setTrackExplicit,
  trackRefKey,
} from "@/lib/explicit-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/tracks/explicit-flag   { sourceType: 'studio'|'legacy', id }
//
// A signed-in listener reports a track as explicit. One flag per listener per
// track (a repeat is accepted silently). Flags queue for the admin Explicit
// Reports page; see src/lib/explicit-flags.ts. If the optional auto-mark
// threshold is configured and reached, the track is labeled explicit right
// away (never removed — removal is always Karl's call).
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId;

  const rl = rateLimit(`explicit-flag:${userId}`, 10, 0.2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're reporting too quickly. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const ref = parseTrackRef(body.sourceType, body.id);
  if (!ref) {
    return NextResponse.json({ error: "Invalid track" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const track = await getFlaggableTrack(supabase, ref);
  if (!track || !track.public) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }
  // Already labeled: nothing to report, and no point queueing it.
  if (track.explicit) {
    return NextResponse.json({ ok: true, alreadyExplicit: true });
  }

  const contentId = trackRefKey(ref);
  const { error } = await supabase.from("content_reports").insert({
    content_type: EXPLICIT_REPORT_TYPE,
    content_id: contentId,
    reported_user: track.ownerProfileId,
    reporter_id: userId,
    reason: "explicit",
  });
  // 23505 = this listener already flagged this track. Treat as success.
  if (error && error.code !== "23505") {
    console.error("Explicit flag insert error:", error);
    return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
  }

  let autoMarked = false;
  const threshold = autoMarkThreshold();
  if (!error && threshold) {
    const { count } = await supabase
      .from("content_reports")
      .select("id", { count: "exact", head: true })
      .eq("content_type", EXPLICIT_REPORT_TYPE)
      .eq("content_id", contentId)
      .eq("status", "open");
    if ((count ?? 0) >= threshold) {
      const { error: markErr } = await setTrackExplicit(supabase, ref, true);
      if (!markErr) {
        autoMarked = true;
        // Leave the reports open so the queue still shows Karl what happened;
        // he can dismiss them or take the track down.
        revalidateTag(PUBLIC_CATALOG_TAG, "max");
        revalidatePath("/");
        revalidatePath("/music");
        if (ref.sourceType === "studio") revalidatePath(`/music/${ref.id}`);
      } else {
        console.error("Explicit auto-mark failed:", markErr);
      }
    }
  }

  return NextResponse.json({ ok: true, autoMarked });
}
