import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { decideConcertVote, type ConcertVoteRefusal } from "@/lib/concertRounds";
import { countConcertRoundVotes } from "@/lib/concertRoundsServer";
import { publishVoteSignal } from "@/lib/pubnubServer";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ spaceId: string }> };

const REFUSAL: Record<ConcertVoteRefusal, { status: number; error: string }> = {
  "voting-closed": { status: 409, error: "Voting is closed. Votes open while a round is live." },
  competitor: { status: 403, error: "Performers can't vote in their own battle." },
  "not-a-performer": { status: 400, error: "You can only vote for one of the two performers." },
  "self-vote": { status: 403, error: "You can't vote for yourself." },
};

// POST /api/concert/battles/:spaceId/vote  { performer_id }
//
// Audience voting for a Concert battle round. One vote per signed-in member
// per round, enforced by the unique (space_id, round_number, voter_id)
// constraint on concert_votes. While the round is open a member may CHANGE
// their vote: the write is an upsert on that key, so the member still holds
// exactly one vote. Once the round closes the vote is final.
//
// The client says only who it is voting for. The round is read from the
// battle on the server, so a stale or hostile client cannot vote into a
// finished round, a future round, or for anyone but the two performers.
//
// After the write, the absolute tally for the round is recounted from the
// table and broadcast over PubNub so every viewer's score bar updates. The
// response carries the same tally so the voter updates immediately.
export async function POST(req: NextRequest, { params }: Props) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const voterId = guard.membership.userId;
  if (!isUuid(voterId)) {
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
  const performerId = typeof body?.performer_id === "string" ? body.performer_id : "";
  if (!isUuid(performerId)) {
    return NextResponse.json({ error: "performer_id must be a UUID." }, { status: 400 });
  }

  const throttle = rateLimit(`concert:vote:${voterId}:${spaceId}`, 10, 1);
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: "Too many votes. Please slow down." },
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
    const { data: battle, error: battleError } = await supabase
      .from("concert_battles")
      .select("space_id, initiator_id, opponent_id, status, current_round")
      .eq("space_id", spaceId)
      .maybeSingle();
    if (battleError) throw battleError;
    if (!battle) {
      return NextResponse.json({ error: "Concert battle not found." }, { status: 404 });
    }

    const roundNumber = Number(battle.current_round) || 0;
    const { data: round, error: roundError } = roundNumber > 0
      ? await supabase
          .from("concert_battle_rounds")
          .select("round_number, state, starts_at, ends_at")
          .eq("space_id", spaceId)
          .eq("round_number", roundNumber)
          .maybeSingle()
      : { data: null, error: null };
    if (roundError) throw roundError;

    const refusal = decideConcertVote({
      voterId,
      performerId,
      battle,
      round,
      nowMs: Date.now(),
    });
    if (refusal) {
      const { status, error } = REFUSAL[refusal];
      return NextResponse.json({ error, reason: refusal }, { status });
    }

    const { error: voteError } = await supabase.from("concert_votes").upsert(
      {
        space_id: spaceId,
        round_number: roundNumber,
        voter_id: voterId,
        performer_id: performerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "space_id,round_number,voter_id" },
    );
    if (voteError) {
      // The database guard trigger refuses a vote once the round has closed;
      // a vote that raced the round ending lands here.
      if (/voting is closed/i.test(voteError.message ?? "")) {
        const { status, error } = REFUSAL["voting-closed"];
        return NextResponse.json({ error, reason: "voting-closed" }, { status });
      }
      throw voteError;
    }

    const tally = await countConcertRoundVotes(supabase, {
      spaceId,
      roundNumber,
      initiatorId: battle.initiator_id,
      opponentId: battle.opponent_id,
    });
    await publishVoteSignal(spaceId, {
      round: roundNumber,
      initiator_votes: tally.initiatorVotes,
      opponent_votes: tally.opponentVotes,
      target: performerId,
    });

    return NextResponse.json({
      ok: true,
      round: roundNumber,
      performer_id: performerId,
      initiator_votes: tally.initiatorVotes,
      opponent_votes: tally.opponentVotes,
    });
  } catch (err) {
    console.error("concert vote failed", err);
    return NextResponse.json({ error: "Could not record your vote." }, { status: 500 });
  }
}
