import {
  planConcertBattleTick,
  planConcertRoundStart,
  resolveConcertBattleOutcome,
  resolveConcertRound,
  type ConcertBattleRow,
  type ConcertRoundAction,
  type ConcertRoundRow,
  type StartRoundAction,
  type FinalizeRoundAction,
} from "./concertRounds";

/**
 * Server side of the Concert round state machine: reads the battle, asks the
 * pure planner in ./concertRounds for the single next transition, and applies
 * it under an optimistic `version` guard.
 *
 * Concurrency model. Three actors can call this at the same instant — both
 * competitors' clients (the moment their countdown hits zero) and the
 * once-a-minute cron. Every battle mutation carries `.eq("version", observed)`,
 * so exactly one of them writes and the rest see zero rows updated and report
 * `stale` without touching anything. That is also why this applies ONE
 * transition per call: a loop that assumed its own write won could skip a round.
 *
 * Round rows are written before the battle row is gated. If the gate then loses
 * the race, the actor that won computed the identical outcome from the identical
 * window, so the duplicate write is a no-op in effect rather than a corruption.
 */

const BATTLE_COLUMNS =
  "space_id, initiator_id, opponent_id, status, current_round, regulation_rounds, round_duration_seconds, phase_started_at, phase_ends_at, winner_id, version";

const ROUND_COLUMNS =
  "round_number, state, starts_at, ends_at, winner_id, initiator_votes, opponent_votes";

/**
 * Structural view of the service-role client. Only the query surface this
 * module actually uses, so the module stays unit-testable against a fake.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConcertDbClient = { from: (table: string) => any };

/**
 * Realtime fan-out for a transition. Injected rather than imported so this
 * module stays testable in a plain Node script: the PubNub server client is
 * `server-only` and cannot be loaded outside the Next runtime. Routes pass
 * `publishSystemSignal`; tests pass nothing and assert on the writes.
 */
export type ConcertNotifier = (
  spaceId: string,
  payload: Record<string, unknown>,
) => Promise<void> | void;

export type ConcertAdvanceOptions = {
  /** Clock injection point. Defaults to now. */
  nowMs?: number;
  notify?: ConcertNotifier;
};

const noopNotifier: ConcertNotifier = () => {};

export type ConcertAdvanceOutcome = {
  spaceId: string;
  /** What actually happened to the battle. */
  applied:
    | "round-started"
    | "round-finalized"
    | "battle-completed"
    | "round-repaired"
    | "none";
  /** The planner's verdict, for observability when nothing was applied. */
  plan: ConcertRoundAction["type"];
  reason?: string;
  roundNumber?: number;
  status?: string;
  winnerId?: string | null;
  /** True when another actor advanced this battle first. */
  stale?: boolean;
};

export async function loadConcertBattle(
  supabase: ConcertDbClient,
  spaceId: string,
): Promise<{ battle: ConcertBattleRow; rounds: ConcertRoundRow[] } | null> {
  const { data: battle, error } = await supabase
    .from("concert_battles")
    .select(BATTLE_COLUMNS)
    .eq("space_id", spaceId)
    .maybeSingle();
  if (error) throw error;
  if (!battle) return null;

  const { data: rounds, error: roundsError } = await supabase
    .from("concert_battle_rounds")
    .select(ROUND_COLUMNS)
    .eq("space_id", spaceId)
    .order("round_number", { ascending: true });
  if (roundsError) throw roundsError;

  return {
    battle: battle as ConcertBattleRow,
    rounds: (rounds ?? []) as ConcertRoundRow[],
  };
}

/**
 * Count the audience votes each competitor received in one round.
 *
 * Votes are keyed by round number (one row per member per round, enforced by a
 * unique constraint), so every round is scored on its own votes only. A row
 * whose performer is not one of the two competitors scores for neither side —
 * the API and a database trigger both refuse such rows, so this is defence in
 * depth, not an expected path.
 */
export async function countConcertRoundVotes(
  supabase: ConcertDbClient,
  args: {
    spaceId: string;
    roundNumber: number;
    initiatorId: string;
    opponentId: string | null;
  },
): Promise<{ initiatorVotes: number; opponentVotes: number }> {
  const { data, error } = await supabase
    .from("concert_votes")
    .select("performer_id")
    .eq("space_id", args.spaceId)
    .eq("round_number", args.roundNumber);
  if (error) throw error;

  let initiatorVotes = 0;
  let opponentVotes = 0;
  for (const row of (data ?? []) as Array<{ performer_id: string | null }>) {
    if (row.performer_id === args.initiatorId) initiatorVotes += 1;
    else if (args.opponentId && row.performer_id === args.opponentId) {
      opponentVotes += 1;
    }
  }
  return { initiatorVotes, opponentVotes };
}

/** Version-guarded battle write. Returns false when another actor won. */
async function gateBattle(
  supabase: ConcertDbClient,
  spaceId: string,
  observedVersion: number,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("concert_battles")
    .update({ ...patch, version: observedVersion + 1 })
    .eq("space_id", spaceId)
    .eq("version", observedVersion)
    .select("space_id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

function staleOutcome(
  spaceId: string,
  plan: ConcertRoundAction["type"],
): ConcertAdvanceOutcome {
  return {
    spaceId,
    applied: "none",
    plan,
    stale: true,
    reason: "version-conflict",
  };
}

async function applyStart(
  supabase: ConcertDbClient,
  battle: ConcertBattleRow,
  action: StartRoundAction,
  notify: ConcertNotifier,
): Promise<ConcertAdvanceOutcome> {
  const { error: roundError } = await supabase
    .from("concert_battle_rounds")
    .upsert(
      {
        space_id: battle.space_id,
        round_number: action.roundNumber,
        state: "active",
        starts_at: action.startsAt,
        ends_at: action.endsAt,
        finalized_at: null,
        winner_id: null,
      },
      { onConflict: "space_id,round_number" },
    );
  if (roundError) throw roundError;

  const won = await gateBattle(supabase, battle.space_id, battle.version, {
    status: "round_active",
    current_round: action.roundNumber,
    phase_started_at: action.startsAt,
    phase_ends_at: action.endsAt,
  });
  if (!won) return staleOutcome(battle.space_id, action.type);

  await notify(battle.space_id, {
    event: "concert-round-started",
    round: action.roundNumber,
    ends_at: action.endsAt,
  });
  return {
    spaceId: battle.space_id,
    applied: "round-started",
    plan: action.type,
    roundNumber: action.roundNumber,
    status: "round_active",
  };
}

async function applyFinalize(
  supabase: ConcertDbClient,
  battle: ConcertBattleRow,
  rounds: readonly ConcertRoundRow[],
  action: FinalizeRoundAction,
  notify: ConcertNotifier,
): Promise<ConcertAdvanceOutcome> {
  const opponentId = battle.opponent_id as string;
  const votes = await countConcertRoundVotes(supabase, {
    spaceId: battle.space_id,
    roundNumber: action.roundNumber,
    initiatorId: battle.initiator_id,
    opponentId,
  });
  const outcome = resolveConcertRound({
    initiatorId: battle.initiator_id,
    opponentId,
    initiatorVotes: votes.initiatorVotes,
    opponentVotes: votes.opponentVotes,
  });

  const finalizedAt = new Date().toISOString();
  // Only an ACTIVE round may be finalized. That predicate is what makes a
  // duplicate tick harmless instead of rewriting a settled result.
  const { error: roundError } = await supabase
    .from("concert_battle_rounds")
    .update({
      state: outcome.state,
      winner_id: outcome.winnerId,
      finalized_at: finalizedAt,
      initiator_votes: votes.initiatorVotes,
      opponent_votes: votes.opponentVotes,
    })
    .eq("space_id", battle.space_id)
    .eq("round_number", action.roundNumber)
    .eq("state", "active");
  if (roundError) throw roundError;

  if (action.next === "intermission") {
    const won = await gateBattle(supabase, battle.space_id, battle.version, {
      status: "round_intermission",
      current_round: action.roundNumber,
      phase_started_at: finalizedAt,
      phase_ends_at: action.intermissionEndsAt ?? finalizedAt,
    });
    if (!won) return staleOutcome(battle.space_id, action.type);

    await notify(battle.space_id, {
      event: "concert-round-finalized",
      round: action.roundNumber,
      winner_id: outcome.winnerId,
      initiator_votes: votes.initiatorVotes,
      opponent_votes: votes.opponentVotes,
      next: "intermission",
    });
    return {
      spaceId: battle.space_id,
      applied: "round-finalized",
      plan: action.type,
      roundNumber: action.roundNumber,
      status: "round_intermission",
      winnerId: outcome.winnerId,
    };
  }

  // Last regulation round: settle the battle from the rounds themselves, with
  // the round just decided folded in (this read predates that write).
  const decided: ConcertRoundRow[] = rounds.map((round) =>
    round.round_number === action.roundNumber
      ? {
          ...round,
          state: outcome.state,
          winner_id: outcome.winnerId,
          initiator_votes: votes.initiatorVotes,
          opponent_votes: votes.opponentVotes,
        }
      : round,
  );
  const battleOutcome = resolveConcertBattleOutcome({
    initiatorId: battle.initiator_id,
    opponentId,
    rounds: decided,
  });
  const won = await gateBattle(supabase, battle.space_id, battle.version, {
    status: "completed",
    current_round: action.roundNumber,
    phase_started_at: null,
    phase_ends_at: null,
    winner_id: battleOutcome.winnerId,
    completion_reason: battleOutcome.completionReason,
    completed_at: finalizedAt,
  });
  if (!won) return staleOutcome(battle.space_id, action.type);

  await notify(battle.space_id, {
    event: "concert-battle-completed",
    winner_id: battleOutcome.winnerId,
    reason: battleOutcome.completionReason,
  });
  return {
    spaceId: battle.space_id,
    applied: "battle-completed",
    plan: action.type,
    roundNumber: action.roundNumber,
    status: "completed",
    winnerId: battleOutcome.winnerId,
  };
}

async function applyComplete(
  supabase: ConcertDbClient,
  battle: ConcertBattleRow,
  rounds: readonly ConcertRoundRow[],
  notify: ConcertNotifier,
): Promise<ConcertAdvanceOutcome> {
  const opponentId = battle.opponent_id as string;
  const outcome = resolveConcertBattleOutcome({
    initiatorId: battle.initiator_id,
    opponentId,
    rounds,
  });
  const now = new Date().toISOString();
  // A winner already on the row is immutable by trigger, so keep it.
  const won = await gateBattle(supabase, battle.space_id, battle.version, {
    status: "completed",
    phase_started_at: null,
    phase_ends_at: null,
    winner_id: battle.winner_id ?? outcome.winnerId,
    completion_reason: outcome.completionReason,
    completed_at: now,
  });
  if (!won) return staleOutcome(battle.space_id, "complete-battle");

  await notify(battle.space_id, {
    event: "concert-battle-completed",
    winner_id: battle.winner_id ?? outcome.winnerId,
    reason: outcome.completionReason,
  });
  return {
    spaceId: battle.space_id,
    applied: "battle-completed",
    plan: "complete-battle",
    status: "completed",
    winnerId: battle.winner_id ?? outcome.winnerId,
  };
}

/**
 * Self-heal the one inconsistency this design can produce: the battle says
 * `round_active` but no round row is active, because a process died between the
 * two writes. Rebuilding the row from the battle's own phase window is strictly
 * better than leaving the stage frozen behind a dead countdown.
 */
async function repairActiveRound(
  supabase: ConcertDbClient,
  battle: ConcertBattleRow,
): Promise<ConcertAdvanceOutcome> {
  const roundNumber = Math.max(1, Number(battle.current_round) || 1);
  const startsAt = battle.phase_started_at ?? new Date().toISOString();
  const endsAt =
    battle.phase_ends_at ??
    new Date(
      Date.parse(startsAt) +
        (Number(battle.round_duration_seconds) || 240) * 1_000,
    ).toISOString();
  const { error } = await supabase.from("concert_battle_rounds").upsert(
    {
      space_id: battle.space_id,
      round_number: roundNumber,
      state: "active",
      starts_at: startsAt,
      ends_at: endsAt,
    },
    { onConflict: "space_id,round_number" },
  );
  if (error) throw error;
  return {
    spaceId: battle.space_id,
    applied: "round-repaired",
    plan: "none",
    roundNumber,
    status: battle.status,
  };
}

/**
 * Advance one battle by at most one transition. Safe to call from anywhere, as
 * often as you like: when nothing is due it reports why and writes nothing.
 */
export async function advanceConcertBattle(
  supabase: ConcertDbClient,
  spaceId: string,
  options: ConcertAdvanceOptions = {},
): Promise<ConcertAdvanceOutcome> {
  const nowMs = options.nowMs ?? Date.now();
  const notify = options.notify ?? noopNotifier;
  const loaded = await loadConcertBattle(supabase, spaceId);
  if (!loaded) {
    return { spaceId, applied: "none", plan: "none", reason: "not-found" };
  }
  const { battle, rounds } = loaded;
  const action = planConcertBattleTick({ battle, rounds, nowMs });

  switch (action.type) {
    case "start-round":
      return applyStart(supabase, battle, action, notify);
    case "finalize-round":
      return applyFinalize(supabase, battle, rounds, action, notify);
    case "complete-battle":
      return applyComplete(supabase, battle, rounds, notify);
    default:
      if (action.reason === "no-active-round") {
        return repairActiveRound(supabase, battle);
      }
      return {
        spaceId,
        applied: "none",
        plan: "none",
        reason: action.reason,
        status: battle.status,
      };
  }
}

/**
 * The initiator's explicit "start round 1". Kept separate from the tick so no
 * scheduled job can ever start a battle its host has not started.
 */
export async function startConcertBattleRounds(
  supabase: ConcertDbClient,
  spaceId: string,
  options: ConcertAdvanceOptions = {},
): Promise<ConcertAdvanceOutcome> {
  const nowMs = options.nowMs ?? Date.now();
  const notify = options.notify ?? noopNotifier;
  const loaded = await loadConcertBattle(supabase, spaceId);
  if (!loaded) {
    return { spaceId, applied: "none", plan: "none", reason: "not-found" };
  }
  const { battle } = loaded;
  const action = planConcertRoundStart(battle, nowMs);
  if (action.type !== "start-round") {
    return {
      spaceId,
      applied: "none",
      plan: "none",
      reason: action.reason,
      status: battle.status,
    };
  }
  return applyStart(supabase, battle, action, notify);
}
