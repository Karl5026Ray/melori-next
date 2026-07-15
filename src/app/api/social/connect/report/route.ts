import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/connect/report — report a dating profile.
//   Body: { reported, category, detail? }
// Categories include the compliance-critical 'underage' and 'ncii' (TAKE IT
// DOWN). The reporter is taken from the verified token; a report is never
// visible to the reported user (RLS enforces this too).
const CATEGORIES = ["harassment", "fake_profile", "underage", "ncii", "other"];

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const rl = rateLimit(`connect:report:${me}`, 5, 0.2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're reporting too quickly. Please slow down." },
      { status: 429, headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reported = typeof body.reported === "string" ? body.reported.trim() : "";
  const category = String(body.category ?? "");
  const detail = typeof body.detail === "string" ? body.detail.slice(0, 2000) : null;
  // Optional evidence linkage when reporting from a conversation.
  const matchId = typeof body.match_id === "string" && isUuid(body.match_id) ? body.match_id : null;
  const messageId =
    typeof body.message_id === "string" && isUuid(body.message_id) ? body.message_id : null;
  const snapshot = typeof body.snapshot === "string" ? body.snapshot.slice(0, 4000) : null;

  if (!isUuid(reported)) {
    return NextResponse.json({ error: "Invalid reported user" }, { status: 400 });
  }
  if (reported === me) {
    return NextResponse.json({ error: "You cannot report yourself" }, { status: 400 });
  }
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Only pin the match/message when the reporter is genuinely a participant, so
  // a caller can't attach evidence pointers to matches they're not part of.
  let safeMatchId: string | null = null;
  let safeMessageId: string | null = null;
  if (matchId) {
    const { data: m } = await supabase
      .from("dating_matches")
      .select("id, user_a, user_b")
      .eq("id", matchId)
      .maybeSingle();
    const mm = m as { id: string; user_a: string; user_b: string } | null;
    if (mm && (mm.user_a === me || mm.user_b === me)) {
      safeMatchId = mm.id;
      if (messageId) {
        const { data: msg } = await supabase
          .from("dating_messages")
          .select("id, match_id")
          .eq("id", messageId)
          .maybeSingle();
        if ((msg as { match_id?: string } | null)?.match_id === mm.id) {
          safeMessageId = messageId;
        }
      }
    }
  }

  const { error } = await supabase.from("dating_reports").insert({
    reporter_id: me,
    reported_id: reported,
    category,
    detail,
    match_id: safeMatchId,
    message_id: safeMessageId,
    snapshot,
  });
  if (error) {
    console.error("dating report insert error", error);
    return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
