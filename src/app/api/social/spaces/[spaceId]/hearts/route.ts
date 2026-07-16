import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/spaces/[spaceId]/hearts — current running total. Public read
// so the counter is populated the instant the room mounts (and after any
// reconnect), mirroring the free "flying hearts" reaction.
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ spaceId: string }> },
) {
  const params = await props.params;
  const spaceId = String(params.spaceId ?? "").trim();
  if (!spaceId || !isUuid(spaceId)) {
    return NextResponse.json({ hearts: 0 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("spaces")
      .select("hearts_count")
      .eq("id", spaceId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { hearts: Number(data?.hearts_count ?? 0) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load hearts" },
      { status: 500 },
    );
  }
}

// POST /api/social/spaces/[spaceId]/hearts — increment the room total and return
// the new running total. Body: { by?: number } (batched taps, clamped 1..50).
// Signed-in only and rate-limited: hearts are tap-spammable. The client
// broadcasts the returned total over the room's Supabase channel so every
// client updates + animates in real time; persisting here means the total
// survives reconnects.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ spaceId: string }> },
) {
  const params = await props.params;
  const spaceId = String(params.spaceId ?? "").trim();
  if (!spaceId || !isUuid(spaceId)) {
    return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
  }

  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId!;

  // ~15 quick taps, ~5/sec sustained — generous but bounded.
  const rl = rateLimit(`social:space-hearts:${userId}`, 15, 5);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're tapping too quickly." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  const body = await req.json().catch(() => ({}));
  const rawBy = Number(body?.by);
  const by = Number.isFinite(rawBy) ? Math.min(Math.max(Math.trunc(rawBy), 1), 50) : 1;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("increment_space_hearts", {
    p_space_id: spaceId,
    p_by: by,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = Array.isArray(data) ? Number(data[0] ?? 0) : Number(data ?? 0);
  return NextResponse.json({ ok: true, hearts: total });
}
