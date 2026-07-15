import { NextRequest, NextResponse } from "next/server";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findOrCreateDirectConversation } from "@/lib/direct-conversation";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/connect/like
// Body: { target_id: string, action: 'like' | 'pass' | 'superlike' }
// Records the caller's swipe. If it's a like/superlike AND the target already
// liked the caller, it's a MATCH: we create the matches row (deduped, ordered
// pair) and open a 1:1 conversation, then return { matched: true, ... }.
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId as string;

  // Anti-spam: swipes are cheap but bounded.
  const rl = rateLimit(`connect:like:${me}`, 30, 2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Slow down a moment." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const targetId = String(body.target_id ?? "").trim();
  const action = String(body.action ?? "like");
  if (!targetId) {
    return NextResponse.json({ error: "target_id required" }, { status: 400 });
  }
  if (targetId === me) {
    return NextResponse.json({ error: "Can't swipe yourself" }, { status: 400 });
  }
  if (!["like", "pass", "superlike"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Block check (either direction).
  const { data: blocks } = await supabase
    .from("member_blocks")
    .select("blocker_id")
    .or(
      `and(blocker_id.eq.${me},blocked_id.eq.${targetId}),` +
        `and(blocker_id.eq.${targetId},blocked_id.eq.${me})`,
    )
    .limit(1);
  if (blocks && blocks.length > 0) {
    return NextResponse.json({ error: "Unavailable." }, { status: 403 });
  }

  // Upsert the swipe (idempotent on liker+liked).
  const { error: swipeErr } = await supabase
    .from("match_likes")
    .upsert(
      { liker_id: me, liked_id: targetId, action },
      { onConflict: "liker_id,liked_id" },
    );
  if (swipeErr) {
    return NextResponse.json({ error: swipeErr.message }, { status: 500 });
  }

  // A pass never matches.
  if (action === "pass") {
    return NextResponse.json({ matched: false });
  }

  // Did the target already like me?
  const { data: reciprocal } = await supabase
    .from("match_likes")
    .select("id, action")
    .eq("liker_id", targetId)
    .eq("liked_id", me)
    .in("action", ["like", "superlike"])
    .maybeSingle();

  if (!reciprocal) {
    return NextResponse.json({ matched: false });
  }

  // It's a match. Ordered pair for the unique constraint.
  const [userA, userB] = me < targetId ? [me, targetId] : [targetId, me];

  // Open (or reuse) a 1:1 conversation for the pair. The helper returns either
  // { id, created } or { error }; the match is still recorded either way.
  let conversationId: string | null = null;
  const conv = await findOrCreateDirectConversation(supabase, me, targetId);
  if ("id" in conv) conversationId = conv.id;

  const { data: match, error: matchErr } = await supabase
    .from("matches")
    .upsert(
      { user_a: userA, user_b: userB, conversation_id: conversationId },
      { onConflict: "user_a,user_b" },
    )
    .select("id, conversation_id")
    .single();
  if (matchErr) {
    return NextResponse.json({ error: matchErr.message }, { status: 500 });
  }

  // Return the matched profile so the UI can show a celebratory card.
  const { data: matchedProfile } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url, verified, role")
    .eq("id", targetId)
    .maybeSingle();

  return NextResponse.json({
    matched: true,
    matchId: match.id,
    conversationId: match.conversation_id,
    profile: matchedProfile,
  });
}
