import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/connect/action — like / pass / super_like a candidate.
//   Body: { target, action: 'like'|'pass'|'super_like', comment? }
// Returns { matched: boolean, match? } — matched is true when this action
// completed a reciprocal like (the DB trigger creates the match row).
const ACTIONS = ["like", "pass", "super_like"];

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const rl = rateLimit(`connect:action:${me}`, 30, 2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Slow down a little." },
      { status: 429, headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const target = typeof body.target === "string" ? body.target.trim() : "";
  const action = String(body.action ?? "");
  const comment =
    typeof body.comment === "string" ? body.comment.trim().slice(0, 280) : null;

  if (!isUuid(target)) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }
  if (target === me) {
    return NextResponse.json({ error: "You cannot act on yourself" }, { status: 400 });
  }
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Defense in depth: reject blocked pairs up front (the RPC also re-checks
  // under the pair lock, which is the authoritative gate).
  const { data: blockRows } = await supabase
    .from("member_blocks")
    .select("blocker_id, blocked_id")
    .or(
      `and(blocker_id.eq.${me},blocked_id.eq.${target}),and(blocker_id.eq.${target},blocked_id.eq.${me})`,
    )
    .limit(1);
  if ((blockRows?.length ?? 0) > 0) {
    return NextResponse.json({ error: "Unavailable" }, { status: 403 });
  }

  // Route through the atomic RPC: it takes a transaction advisory lock on the
  // canonical pair, re-checks blocks, upserts the action, and creates the match
  // on a reciprocal like — all in one transaction, closing the concurrent-like
  // race a trigger-only path had.
  const { data, error } = await supabase.rpc("create_dating_action", {
    p_actor: me,
    p_target: target,
    p_action: action,
    p_comment: comment,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The RPC returns a single row { matched, match_id }.
  const row = Array.isArray(data) ? data[0] : data;
  const matched = !!row?.matched;
  let match = null;
  if (matched && row?.match_id) {
    const { data: m } = await supabase
      .from("dating_matches")
      .select("id, user_a, user_b, status, created_at")
      .eq("id", row.match_id)
      .maybeSingle();
    match = m ?? { id: row.match_id };
  }

  return NextResponse.json({ ok: true, matched, match });
}
