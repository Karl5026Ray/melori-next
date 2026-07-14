import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Social follow graph (one-directional, "like any other platform").
//
//   GET    /api/social/follow?target=<userId>  → { following: boolean, followers_count, following_count }
//   POST   /api/social/follow  body { target }  → follow target
//   DELETE /api/social/follow?target=<userId>   → unfollow target
//
// The caller is always taken from the auth token (never the body), so a user
// can only manage their OWN follow rows. Block relationships in either
// direction prevent following, mirroring the directory's visibility rules.

async function resolveTarget(req: NextRequest, bodyTarget?: unknown): Promise<string | null> {
  if (typeof bodyTarget === "string" && bodyTarget.trim()) return bodyTarget.trim();
  const t = new URL(req.url).searchParams.get("target");
  return t && t.trim() ? t.trim() : null;
}

// True if either party has blocked the other.
async function isBlocked(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  a: string,
  b: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("member_blocks")
    .select("blocker_id, blocked_id")
    .or(
      `and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`,
    )
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;
  const target = await resolveTarget(req);
  if (!target) {
    return NextResponse.json({ error: "target is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const [{ data: rel }, { data: prof }] = await Promise.all([
    supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", me)
      .eq("following_id", target)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("followers_count, following_count")
      .eq("id", target)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    following: !!rel,
    followers_count: prof?.followers_count ?? 0,
    following_count: prof?.following_count ?? 0,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* target may still come from the query string */
  }
  const target = await resolveTarget(req, (body as { target?: unknown })?.target);
  if (!target) {
    return NextResponse.json({ error: "target is required" }, { status: 400 });
  }
  if (target === me) {
    return NextResponse.json({ error: "You cannot follow yourself" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Target must exist and be an active account.
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("id, status")
    .eq("id", target)
    .maybeSingle();
  if (!targetProfile) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (targetProfile.status && targetProfile.status !== "active") {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (await isBlocked(supabase, me, target)) {
    return NextResponse.json(
      { error: "You cannot follow this member" },
      { status: 403 },
    );
  }

  // Idempotent: ignore duplicate follows (primary key already enforces this).
  const { error } = await supabase
    .from("follows")
    .upsert(
      { follower_id: me, following_id: target },
      { onConflict: "follower_id,following_id", ignoreDuplicates: true },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("followers_count, following_count")
    .eq("id", target)
    .maybeSingle();

  return NextResponse.json({
    following: true,
    followers_count: prof?.followers_count ?? 0,
    following_count: prof?.following_count ?? 0,
  });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;
  const target = await resolveTarget(req);
  if (!target) {
    return NextResponse.json({ error: "target is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", me)
    .eq("following_id", target);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("followers_count, following_count")
    .eq("id", target)
    .maybeSingle();

  return NextResponse.json({
    following: false,
    followers_count: prof?.followers_count ?? 0,
    following_count: prof?.following_count ?? 0,
  });
}
