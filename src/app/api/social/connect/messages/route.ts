import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Match-gated dating messages (separate channel from general DMs).
//   GET  ?match_id=<uuid> — messages for a match (participant + active only).
//   POST body { match_id, body } — send a message (same gating).

// Resolve a match the caller participates in and that is currently active.
async function getActiveMatch(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  matchId: string,
  me: string,
) {
  const { data } = await supabase
    .from("dating_matches")
    .select("id, user_a, user_b, status")
    .eq("id", matchId)
    .maybeSingle();
  if (!data) return null;
  const m = data as { id: string; user_a: string; user_b: string; status: string };
  if (m.user_a !== me && m.user_b !== me) return null;
  return m;
}

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const matchId = new URL(req.url).searchParams.get("match_id") ?? "";
  if (!isUuid(matchId)) {
    return NextResponse.json({ error: "Invalid match_id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const match = await getActiveMatch(supabase, matchId, me);
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  // Messages remain readable to participants even if unmatched (soft state),
  // but sending is blocked below. Reading a live conversation requires active.
  if (match.status !== "active") {
    return NextResponse.json({ error: "This match is no longer active", status: match.status }, { status: 403 });
  }

  const { data } = await supabase
    .from("dating_messages")
    .select("id, match_id, sender_id, body, created_at, read_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true })
    .limit(500);

  // Mark inbound messages as read.
  await supabase
    .from("dating_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("match_id", matchId)
    .neq("sender_id", me)
    .is("read_at", null);

  const otherId = match.user_a === me ? match.user_b : match.user_a;
  return NextResponse.json({
    messages: (data ?? []).map((m) => {
      const r = m as { id: string; sender_id: string; body: string; created_at: string };
      return { ...r, from_me: r.sender_id === me };
    }),
    other_id: otherId,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const rl = rateLimit(`connect:msg:${me}`, 20, 2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're sending messages too quickly." },
      { status: 429, headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const matchId = typeof body.match_id === "string" ? body.match_id.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!isUuid(matchId)) {
    return NextResponse.json({ error: "Invalid match_id" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const match = await getActiveMatch(supabase, matchId, me);
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  if (match.status !== "active") {
    return NextResponse.json({ error: "This match is no longer active" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("dating_messages")
    .insert({ match_id: matchId, sender_id: me, body: text.slice(0, 2000) })
    .select("id, match_id, sender_id, body, created_at, read_at")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, message: data ? { ...data, from_me: true } : null });
}
