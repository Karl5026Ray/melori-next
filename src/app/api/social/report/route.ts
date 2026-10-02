import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import { sendLiveRoomReportEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/report — user-submitted content report (the human backstop
// to automated moderation). Any signed-in user can report. The reporter is
// taken from the verified token, never the body. Duplicate reports on the same
// item by the same reporter are absorbed silently (unique index).
//
// Body: {
//   content_type: 'message'|'comment'|'gallery'|'profile'|'track'|'video'|
//                 'space'|'space_chat'|'other',
//   content_id?: string,
//   reported_user?: string (uuid),
//   reason?: string,   // e.g. 'nudity','harassment','spam','other'
//   details?: string,  // free-text
// }

// 'space' is a live room and 'space_chat' one line of its chat (space_comments).
// They are deliberately NOT 'comment', which the admin queue maps to
// community_comments for hide/restore; an unmapped type can only be reviewed
// and dismissed there, so a room report can never hide an unrelated row.
const CONTENT_TYPES = [
  "message",
  "comment",
  "gallery",
  "profile",
  "track",
  "video",
  "space",
  "space_chat",
  "other",
];
const LIVE_ROOM_TYPES = new Set(["space", "space_chat"]);

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  const rl = rateLimit(`social:report:${membership.userId}`, 5, 0.2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're reporting too quickly. Please slow down." },
      { status: 429, headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
    );
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const contentType = String(body.content_type ?? "other");
  if (!CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }
  const contentId = body.content_id ? String(body.content_id).slice(0, 128) : null;
  const reportedUser = body.reported_user ? String(body.reported_user) : null;
  const reason = body.reason ? String(body.reason).slice(0, 64) : null;
  const details = body.details ? String(body.details).slice(0, 1000) : null;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("content_reports").insert({
    content_type: contentType,
    content_id: contentId,
    reported_user: reportedUser,
    reporter_id: membership.userId,
    reason,
    details,
  });

  // Duplicate report (unique index violation) is treated as success — the user
  // already reported this item; no need to surface an error.
  if (error && error.code !== "23505") {
    console.error("Report insert error:", error);
    return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
  }

  // A live room is happening now, so a queue check tomorrow is too late. Email
  // the founder right away. Best-effort: the report is already saved.
  // Awaited: a serverless function may be frozen once the response is sent.
  if (!error && LIVE_ROOM_TYPES.has(contentType)) {
    try {
      await sendLiveRoomReportEmail({ contentType, contentId, reason, details });
    } catch (err) {
      console.error("Live room report email failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
