import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/block — list the members the caller has blocked, hydrated
// with enough profile info to render a "Blocked members" management screen.
// Only rows the caller created (blocker_id = caller) are returned, so this is
// naturally scoped to the authenticated user.
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from("member_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", membership.userId)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (rows ?? []).map((r) => r.blocked_id as string);
  let profilesById = new Map<string, Record<string, unknown>>();
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, role")
      .in("id", ids);
    profilesById = new Map((profs ?? []).map((p) => [p.id as string, p]));
  }

  const blocked = (rows ?? []).map((r) => ({
    id: r.blocked_id,
    created_at: r.created_at,
    profile: profilesById.get(r.blocked_id as string) ?? null,
  }));

  return NextResponse.json(
    { blocked },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  // Per-user rate limit — block/unblock spam previously could churn the
  // member_blocks table (each toggle is a delete+insert) with no ceiling.
  // 5 burst then ~1 per second per caller is plenty for legitimate UI use.
  const rl = rateLimit(`social:block:${membership.userId}`, 5, 1);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many block changes. Slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  const body = await req.json().catch(() => ({}));
  const blockedId = String(body.blocked_id ?? "").trim();
  const unblock = body.unblock === true;

  if (!blockedId) {
    return NextResponse.json({ error: "blocked_id required" }, { status: 400 });
  }
  // Reject non-UUID strings early: member_blocks.blocked_id references
  // profiles.id (a uuid) — without this check, callers could POST arbitrary
  // text and (on unblock) burn a DB delete against nothing, or (on insert)
  // rely on Postgres to reject the FK with a noisy 500.
  if (!isUuid(blockedId)) {
    return NextResponse.json({ error: "Invalid blocked_id" }, { status: 400 });
  }
  if (blockedId === membership.userId) {
    return NextResponse.json({ error: "You can't block yourself" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  if (unblock) {
    const { error } = await supabase
      .from("member_blocks")
      .delete()
      .eq("blocker_id", membership.userId)
      .eq("blocked_id", blockedId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, blocked: false });
  }

  const { error } = await supabase
    .from("member_blocks")
    .upsert({ blocker_id: membership.userId, blocked_id: blockedId });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, blocked: true });
}
