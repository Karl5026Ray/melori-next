import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  advanceConcertBattle,
  type ConcertAdvanceOutcome,
} from "@/lib/concertRoundsServer";
import { publishSystemSignal } from "@/lib/pubnubServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET/POST /api/cron/concert-battle-rounds
//
// THE GUARANTEE BEHIND CONCERT ROUND TIMERS.
// ------------------------------------------
// A battle round has a hard deadline in `concert_battles.phase_ends_at`, and
// the live stage counts down against it. Something has to actually act when that
// countdown reaches zero. The fast path is a competitor's own client, which
// calls POST /api/concert/battles/:spaceId/rounds { action: "advance" } the
// instant its timer expires — but that path exists only while someone is
// watching with a working connection. If both competitors' tabs are backgrounded
// or drop, a round would otherwise hang at 00:00 forever.
//
// This cron is that backstop: once a minute it finds every battle whose phase
// deadline has passed and applies exactly one transition per battle
// (finalize -> intermission -> next round -> completed), using the same
// version-guarded applier the client path uses. Racing the client is safe by
// construction: the loser of the optimistic `version` guard writes nothing and
// reports `stale`.
//
// It deliberately never STARTS a battle. Round 1 begins only when the initiator
// presses start; a scheduled job must not push an unattended room live.
//
// Auth: same shared-secret model as the other cron routes —
// `x-cron-secret: $CRON_SECRET` or `Authorization: Bearer $CRON_SECRET`.

// Safety valve for a single invocation. Far above any realistic count of
// concurrently live battles, but keeps one bad backlog from running the
// function to its timeout.
const MAX_BATTLES_PER_TICK = 50;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // Only battles whose deadline has already passed. A live round mid-flight is
  // none of this job's business.
  const { data: due, error } = await supabase
    .from("concert_battles")
    .select("space_id, status, phase_ends_at")
    .in("status", ["round_active", "round_intermission"])
    .lte("phase_ends_at", nowIso)
    .order("phase_ends_at", { ascending: true })
    .limit(MAX_BATTLES_PER_TICK);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "query failed" },
      { status: 500 },
    );
  }

  const candidates = due ?? [];
  const results: ConcertAdvanceOutcome[] = [];
  const failures: Array<{ space_id: string; error: string }> = [];

  // Sequential: the live-battle set is small, and one failing battle must not
  // take the rest of the sweep down with it.
  for (const row of candidates) {
    try {
      results.push(await advanceConcertBattle(supabase, row.space_id, {
          notify: publishSystemSignal,
        }));
    } catch (err) {
      console.error("concert round advance failed", row.space_id, err);
      failures.push({
        space_id: row.space_id,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  const counted = (applied: ConcertAdvanceOutcome["applied"]) =>
    results.filter((r) => r.applied === applied).length;

  return NextResponse.json({
    ok: true,
    now: nowIso,
    due: candidates.length,
    started: counted("round-started"),
    finalized: counted("round-finalized"),
    completed: counted("battle-completed"),
    repaired: counted("round-repaired"),
    unchanged: counted("none"),
    failures,
    results,
  });
}

export const GET = handle;
export const POST = handle;
