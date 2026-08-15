import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getConcertBattleSlot } from "@/lib/concertBattle";
import {
  advanceConcertBattle,
  startConcertBattleRounds,
} from "@/lib/concertRoundsServer";
import { publishSystemSignal } from "@/lib/pubnubServer";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ spaceId: string }> };

// POST /api/concert/battles/:spaceId/rounds  { action: "start" | "advance" }
//
// The competitor-facing half of the round state machine.
//
//   start   — initiator only. Begins round 1 from `ready`. Round 1 is never
//             automatic: the host decides when the room is actually ready to go
//             live, so no scheduled job may start a battle for them.
//   advance — either competitor. Called by the live stage the moment its
//             countdown hits zero, so a round ends instantly for everyone
//             watching instead of waiting for the next cron minute.
//
// Neither action carries any state from the client. The request says only which
// intent it has; the server re-reads the battle and lets the pure planner decide
// what may happen, so a hostile or stale client cannot skip a round, extend its
// own round, or declare a winner. `advance` is idempotent and version-guarded:
// two clients and the cron firing at the same instant produce exactly one
// transition.
export async function POST(req: NextRequest, { params }: Props) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId;
  if (!isUuid(userId)) {
    return NextResponse.json(
      { error: "Authenticated member id must be a UUID." },
      { status: 400 },
    );
  }
  const { spaceId } = await params;
  if (!isUuid(spaceId)) {
    return NextResponse.json({ error: "spaceId must be a UUID." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "advance").trim();
  if (action !== "start" && action !== "advance") {
    return NextResponse.json(
      { error: 'action must be "start" or "advance".' },
      { status: 400 },
    );
  }

  // Generous enough for a per-second client poll to be safe on the advance path,
  // tight enough that this cannot be used to hammer the battle tables.
  const throttle = rateLimit(`concert:rounds:${userId}:${spaceId}`, 12, 1);
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: "Too many round requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(throttle.retryAfterMs / 1000).toString(),
        },
      },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: battle, error } = await supabase
      .from("concert_battles")
      .select("space_id, initiator_id, opponent_id, status")
      .eq("space_id", spaceId)
      .maybeSingle();
    if (error) throw error;
    if (!battle) {
      return NextResponse.json(
        { error: "Concert battle not found." },
        { status: 404 },
      );
    }

    // Only the two performers may move the clock. The audience gifts; it does
    // not run the format.
    const slot = getConcertBattleSlot(battle, userId);
    if (!slot) {
      return NextResponse.json(
        { error: "Only a battle competitor can change rounds." },
        { status: 403 },
      );
    }
    if (action === "start" && slot !== 1) {
      return NextResponse.json(
        { error: "Only the battle host can start round one." },
        { status: 403 },
      );
    }

    const outcome =
      action === "start"
        ? await startConcertBattleRounds(supabase, spaceId, {
            notify: publishSystemSignal,
          })
        : await advanceConcertBattle(supabase, spaceId, {
            notify: publishSystemSignal,
          });

    // A no-op is a legitimate answer here (the phase is still running, or
    // another actor already advanced), so this is 200 with the verdict attached
    // rather than an error the client has to special-case.
    return NextResponse.json({ ok: true, action, outcome });
  } catch (err) {
    console.error("concert rounds route failed", err);
    return NextResponse.json(
      { error: "Unable to update the battle round." },
      { status: 500 },
    );
  }
}
