/* eslint-disable no-console */
// Contracts for the Concert battle ROUND LIFECYCLE.
//
// Before this existed a battle could reach `round_active` and then freeze: the
// countdown hit 00:00 and nothing moved. Two layers are pinned here.
//
//   1. src/lib/concertRounds.ts — the pure planner. Which single transition is
//      due, who won a round, who won the battle.
//   2. src/lib/concertRoundsServer.ts — the applier, exercised against a fake
//      Supabase client. The two properties that matter most in production live
//      here: gift coins are counted PER ROUND WINDOW (not battle-wide), and
//      every battle write is guarded by `version` so the client fast path and
//      the cron backstop firing together still produce exactly one transition.

import {
  CONCERT_BATTLE_INTERMISSION_SECONDS,
  canStartConcertRound,
  formatConcertPhaseCountdown,
  formatConcertRoundLabel,
  isConcertPhaseExpired,
  planConcertBattleTick,
  planConcertRoundStart,
  resolveConcertBattleOutcome,
  resolveConcertRound,
  type ConcertBattleRow,
  type ConcertRoundRow,
} from "../src/lib/concertRounds";
import {
  advanceConcertBattle,
  startConcertBattleRounds,
} from "../src/lib/concertRoundsServer";

let failures = 0;
function check(label: string, value: boolean) {
  if (value) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

const INITIATOR = "11111111-1111-4111-8111-111111111111";
const OPPONENT = "22222222-2222-4222-8222-222222222222";
const AUDIENCE = "33333333-3333-4333-8333-333333333333";
const SPACE = "44444444-4444-4444-8444-444444444444";

const NOW = Date.parse("2026-08-15T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function battle(overrides: Partial<ConcertBattleRow> = {}): ConcertBattleRow {
  return {
    space_id: SPACE,
    initiator_id: INITIATOR,
    opponent_id: OPPONENT,
    status: "ready",
    current_round: 0,
    regulation_rounds: 3,
    round_duration_seconds: 240,
    phase_started_at: null,
    phase_ends_at: null,
    winner_id: null,
    version: 7,
    ...overrides,
  };
}

function round(
  number: number,
  overrides: Partial<ConcertRoundRow> = {},
): ConcertRoundRow {
  return {
    round_number: number,
    state: "finalized",
    starts_at: iso(NOW - 600_000),
    ends_at: iso(NOW - 360_000),
    winner_id: INITIATOR,
    initiator_coins_total: 100,
    opponent_coins_total: 50,
    ...overrides,
  };
}

console.log("\nConcert battle round lifecycle\n");

// --- Planner: nothing is due ------------------------------------------------
console.log("Planner — no transition due");

check(
  "a completed battle never transitions again",
  planConcertBattleTick({
    battle: battle({ status: "completed" }),
    rounds: [],
    nowMs: NOW,
  }).type === "none",
);
for (const status of ["cancelled", "expired", "forfeited"] as const) {
  const plan = planConcertBattleTick({
    battle: battle({ status }),
    rounds: [],
    nowMs: NOW,
  });
  check(
    `${status} is terminal`,
    plan.type === "none" && plan.reason === "terminal",
  );
}

{
  const plan = planConcertBattleTick({
    battle: battle({ status: "invited", opponent_id: null }),
    rounds: [],
    nowMs: NOW,
  });
  check(
    "a battle with an empty performer slot is not advanceable",
    plan.type === "none" && plan.reason === "no-opponent",
  );
}

{
  const plan = planConcertBattleTick({
    battle: battle({ status: "ready" }),
    rounds: [],
    nowMs: NOW,
  });
  check(
    "ready never auto-starts round 1 — the host does",
    plan.type === "none" && plan.reason === "not-started",
  );
}

{
  // The single most important negative case: a round mid-flight is untouchable.
  const plan = planConcertBattleTick({
    battle: battle({
      status: "round_active",
      current_round: 1,
      phase_started_at: iso(NOW - 60_000),
      phase_ends_at: iso(NOW + 180_000),
    }),
    rounds: [
      round(1, {
        state: "active",
        winner_id: null,
        starts_at: iso(NOW - 60_000),
        ends_at: iso(NOW + 180_000),
      }),
    ],
    nowMs: NOW,
  });
  check(
    "a running round is never cut short",
    plan.type === "none" && plan.reason === "phase-still-running",
  );
}

{
  const plan = planConcertBattleTick({
    battle: battle({
      status: "round_intermission",
      current_round: 1,
      phase_ends_at: iso(NOW + 30_000),
    }),
    rounds: [round(1)],
    nowMs: NOW,
  });
  check(
    "an unfinished intermission is not cut short",
    plan.type === "none" && plan.reason === "phase-still-running",
  );
}

// --- Planner: start ---------------------------------------------------------
console.log("\nPlanner — starting rounds");

{
  const plan = planConcertRoundStart(battle({ status: "ready" }), NOW);
  check("the host can start round 1 from ready", plan.type === "start-round");
  check(
    "round 1 runs for the battle's declared duration",
    plan.type === "start-round" &&
      Date.parse(plan.endsAt) - Date.parse(plan.startsAt) === 240_000,
  );
  check(
    "round 1 is numbered 1",
    plan.type === "start-round" && plan.roundNumber === 1,
  );
}
check(
  "start is refused without an opponent",
  planConcertRoundStart(battle({ opponent_id: null }), NOW).type === "none",
);
check(
  "start is refused once a round is already live",
  planConcertRoundStart(battle({ status: "round_active" }), NOW).type === "none",
);
check("canStartConcertRound gates on ready", canStartConcertRound(battle()));
check(
  "canStartConcertRound is false mid-battle",
  !canStartConcertRound(battle({ status: "round_active" })),
);

{
  // Intermission expiry is what starts rounds 2 and 3.
  const plan = planConcertBattleTick({
    battle: battle({
      status: "round_intermission",
      current_round: 1,
      phase_ends_at: iso(NOW - 1_000),
    }),
    rounds: [round(1)],
    nowMs: NOW,
  });
  check(
    "an expired intermission starts the next round",
    plan.type === "start-round" && plan.roundNumber === 2,
  );
}

{
  const plan = planConcertBattleTick({
    battle: battle({
      status: "round_intermission",
      current_round: 2,
      phase_ends_at: null,
    }),
    rounds: [round(1), round(2, { state: "draw", winner_id: null })],
    nowMs: NOW,
  });
  check(
    "an intermission with no deadline cannot stall the battle",
    plan.type === "start-round" && plan.roundNumber === 3,
  );
  check(
    "a drawn round still counts as played",
    plan.type === "start-round" && plan.roundNumber === 3,
  );
}

// --- Planner: finalize ------------------------------------------------------
console.log("\nPlanner — finalizing rounds");

function expiredActive(roundNumber: number, extraRounds: ConcertRoundRow[] = []) {
  return planConcertBattleTick({
    battle: battle({
      status: "round_active",
      current_round: roundNumber,
      phase_started_at: iso(NOW - 240_000),
      phase_ends_at: iso(NOW - 1_000),
    }),
    rounds: [
      ...extraRounds,
      round(roundNumber, {
        state: "active",
        winner_id: null,
        starts_at: iso(NOW - 240_000),
        ends_at: iso(NOW - 1_000),
      }),
    ],
    nowMs: NOW,
  });
}

{
  const plan = expiredActive(1);
  check(
    "an expired round 1 is finalized",
    plan.type === "finalize-round" && plan.roundNumber === 1,
  );
  check(
    "round 1 hands off to an intermission, not the end",
    plan.type === "finalize-round" && plan.next === "intermission",
  );
  check(
    "the scoring window is the round's own window, not the battle's",
    plan.type === "finalize-round" &&
      plan.windowStart === iso(NOW - 240_000) &&
      plan.windowEnd === iso(NOW - 1_000),
  );
  check(
    "the intermission is the declared length",
    plan.type === "finalize-round" &&
      Date.parse(plan.intermissionEndsAt ?? "") - NOW ===
        CONCERT_BATTLE_INTERMISSION_SECONDS * 1_000,
  );
}

{
  const plan = expiredActive(3, [round(1), round(2)]);
  check(
    "the last regulation round completes the battle",
    plan.type === "finalize-round" && plan.next === "complete",
  );
  check(
    "no intermission is scheduled after the last round",
    plan.type === "finalize-round" && plan.intermissionEndsAt === undefined,
  );
}

{
  // A round row whose start was lost must not be scored against the whole
  // battle: that would credit round 1's gifts to round 3.
  const plan = planConcertBattleTick({
    battle: battle({
      status: "round_active",
      current_round: 2,
      phase_started_at: null,
      phase_ends_at: iso(NOW - 1_000),
    }),
    rounds: [
      round(1),
      round(2, {
        state: "active",
        winner_id: null,
        starts_at: null,
        ends_at: iso(NOW - 1_000),
      }),
    ],
    nowMs: NOW,
  });
  check(
    "a lost round start falls back to one round duration, not the battle start",
    plan.type === "finalize-round" &&
      Date.parse(plan.windowEnd) - Date.parse(plan.windowStart) === 240_000,
  );
}

{
  const plan = planConcertBattleTick({
    battle: battle({
      status: "round_active",
      current_round: 1,
      phase_ends_at: iso(NOW - 1_000),
    }),
    rounds: [],
    nowMs: NOW,
  });
  check(
    "an active battle with no active round is reported, not guessed at",
    plan.type === "none" && plan.reason === "no-active-round",
  );
}

{
  const plan = planConcertBattleTick({
    battle: battle({
      status: "round_intermission",
      current_round: 3,
      phase_ends_at: iso(NOW - 1_000),
    }),
    rounds: [round(1), round(2), round(3)],
    nowMs: NOW,
  });
  check(
    "all regulation rounds played completes the battle",
    plan.type === "complete-battle",
  );
}

// --- Round outcomes ---------------------------------------------------------
console.log("\nRound outcomes");

check(
  "more coins in the window wins the round",
  resolveConcertRound({
    initiatorId: INITIATOR,
    opponentId: OPPONENT,
    initiatorCoins: 120,
    opponentCoins: 119,
  }).winnerId === INITIATOR,
);
check(
  "the opponent can win a round",
  resolveConcertRound({
    initiatorId: INITIATOR,
    opponentId: OPPONENT,
    initiatorCoins: 0,
    opponentCoins: 15,
  }).winnerId === OPPONENT,
);
{
  const tie = resolveConcertRound({
    initiatorId: INITIATOR,
    opponentId: OPPONENT,
    initiatorCoins: 60,
    opponentCoins: 60,
  });
  check("an exact tie is a draw", tie.state === "draw");
  check("a drawn round records no winner", tie.winnerId === null);
}
{
  const empty = resolveConcertRound({
    initiatorId: INITIATOR,
    opponentId: OPPONENT,
    initiatorCoins: 0,
    opponentCoins: 0,
  });
  check("a round with no gifts at all is a draw", empty.state === "draw");
}

// --- Battle outcomes -------------------------------------------------------
console.log("\nBattle outcomes");

{
  const outcome = resolveConcertBattleOutcome({
    initiatorId: INITIATOR,
    opponentId: OPPONENT,
    rounds: [
      round(1, { winner_id: INITIATOR }),
      round(2, { winner_id: OPPONENT }),
      round(3, { winner_id: INITIATOR }),
    ],
  });
  check("2-1 on rounds wins the battle", outcome.winnerId === INITIATOR);
  check("that win is regulation", outcome.completionReason === "regulation");
  check(
    "rounds won are counted per competitor",
    outcome.initiatorRoundsWon === 2 && outcome.opponentRoundsWon === 1,
  );
}

{
  // The format's promise: winning two rounds narrowly beats winning one huge.
  const outcome = resolveConcertBattleOutcome({
    initiatorId: INITIATOR,
    opponentId: OPPONENT,
    rounds: [
      round(1, {
        winner_id: INITIATOR,
        initiator_coins_total: 10,
        opponent_coins_total: 9,
      }),
      round(2, {
        winner_id: INITIATOR,
        initiator_coins_total: 10,
        opponent_coins_total: 9,
      }),
      round(3, {
        winner_id: OPPONENT,
        initiator_coins_total: 0,
        opponent_coins_total: 5_000,
      }),
    ],
  });
  check(
    "two narrow round wins beat one landslide",
    outcome.winnerId === INITIATOR && outcome.completionReason === "regulation",
  );
}

{
  const outcome = resolveConcertBattleOutcome({
    initiatorId: INITIATOR,
    opponentId: OPPONENT,
    rounds: [
      round(1, { winner_id: INITIATOR, initiator_coins_total: 50, opponent_coins_total: 0 }),
      round(2, { winner_id: OPPONENT, initiator_coins_total: 0, opponent_coins_total: 10 }),
      round(3, { state: "draw", winner_id: null, initiator_coins_total: 5, opponent_coins_total: 5 }),
    ],
  });
  check(
    "a round tie is broken on total coins",
    outcome.winnerId === INITIATOR &&
      outcome.completionReason === "coins_tiebreak",
  );
}

{
  const outcome = resolveConcertBattleOutcome({
    initiatorId: INITIATOR,
    opponentId: OPPONENT,
    rounds: [
      round(1, { state: "draw", winner_id: null, initiator_coins_total: 10, opponent_coins_total: 10 }),
      round(2, { state: "draw", winner_id: null, initiator_coins_total: 0, opponent_coins_total: 0 }),
      round(3, { state: "draw", winner_id: null, initiator_coins_total: 7, opponent_coins_total: 7 }),
    ],
  });
  check("dead even on rounds and coins is a draw", outcome.winnerId === null);
  check("a drawn battle says so", outcome.completionReason === "draw");
}

{
  const outcome = resolveConcertBattleOutcome({
    initiatorId: INITIATOR,
    opponentId: OPPONENT,
    rounds: [
      round(1),
      round(2, { state: "active", winner_id: null, initiator_coins_total: 9_999 }),
    ],
  });
  check(
    "an unfinished round contributes nothing to the outcome",
    outcome.initiatorCoins === 100 && outcome.initiatorRoundsWon === 1,
  );
}

// --- Labels ----------------------------------------------------------------
console.log("\nStage labels");

check(
  "an active round is labelled with its number",
  formatConcertRoundLabel({
    status: "round_active",
    current_round: 2,
    regulation_rounds: 3,
  }) === "Round 2 of 3",
);
check(
  "an intermission points at what's next",
  formatConcertRoundLabel({
    status: "round_intermission",
    current_round: 1,
    regulation_rounds: 3,
  }).includes("next up"),
);
check(
  "the last intermission does not promise another round",
  formatConcertRoundLabel({
    status: "round_intermission",
    current_round: 3,
    regulation_rounds: 3,
  }) === "Final scores",
);
check(
  "a completed battle is labelled as over",
  formatConcertRoundLabel({
    status: "completed",
    current_round: 3,
    regulation_rounds: 3,
  }) === "Battle over",
);

// --- Phase countdown -------------------------------------------------------
console.log("\nPhase countdown");

check(
  "a live round counts down",
  formatConcertPhaseCountdown(
    { status: "round_active", phase_ends_at: iso(NOW + 125_000) },
    NOW,
  ) === "02:05",
);
check(
  "an intermission also counts down, so the stage never looks frozen",
  formatConcertPhaseCountdown(
    { status: "round_intermission", phase_ends_at: iso(NOW + 30_000) },
    NOW,
  ) === "00:30",
);
check(
  "a past deadline floors at zero rather than going negative",
  formatConcertPhaseCountdown(
    { status: "round_active", phase_ends_at: iso(NOW - 9_000) },
    NOW,
  ) === "00:00",
);
check(
  "a battle that is not running shows no clock",
  formatConcertPhaseCountdown(
    { status: "ready", phase_ends_at: iso(NOW + 30_000) },
    NOW,
  ) === "--:--",
);
check(
  "an expired round is reported as expired",
  isConcertPhaseExpired(
    { status: "round_active", phase_ends_at: iso(NOW - 1) },
    NOW,
  ),
);
check(
  "a running round is not expired",
  !isConcertPhaseExpired(
    { status: "round_active", phase_ends_at: iso(NOW + 1_000) },
    NOW,
  ),
);
check(
  "a ready battle is never 'expired' — the host starts it",
  !isConcertPhaseExpired({ status: "ready", phase_ends_at: null }, NOW),
);
check(
  "an intermission with no deadline is treated as expired, not as forever",
  isConcertPhaseExpired({ status: "round_intermission", phase_ends_at: null }, NOW),
);

// --- Applier ---------------------------------------------------------------
// A fake Supabase good enough for the applier's exact query shapes. It records
// every write so the version guard and the scoring window can be asserted.
console.log("\nApplier — version guard and per-round scoring");

// Wrapped in a function because tsx compiles these scripts to CJS, where
// top-level await is not available.
async function applierContracts() {

type GiftRow = { target_id: string | null; coins_spent: number; created_at: string };

type FakeState = {
  battle: (ConcertBattleRow & Record<string, unknown>) | null;
  rounds: Array<ConcertRoundRow & Record<string, unknown>>;
  gifts: GiftRow[];
  battleUpdates: Array<Record<string, unknown>>;
  roundUpdates: Array<Record<string, unknown>>;
  roundUpserts: Array<Record<string, unknown>>;
  giftQueries: Array<{ gte?: string; lt?: string }>;
};

function fakeDb(state: FakeState) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const range: { gte?: string; lt?: string } = {};
      let mode: "select" | "update" | "upsert" = "select";
      let patch: Record<string, unknown> = {};

      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        gte(_column: string, value: string) {
          range.gte = value;
          return builder;
        },
        lt(_column: string, value: string) {
          range.lt = value;
          return builder;
        },
        in() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        update(next: Record<string, unknown>) {
          mode = "update";
          patch = next;
          return builder;
        },
        upsert(next: Record<string, unknown>) {
          mode = "upsert";
          patch = next;
          return settle();
        },
        maybeSingle() {
          return settle();
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(settle()).then(resolve);
        },
      };

      function settle() {
        if (table === "concert_battles") {
          if (mode === "update") {
            state.battleUpdates.push({ ...patch, __where: { ...filters } });
            const current = state.battle;
            // The optimistic guard: the write lands only when the observed
            // version still matches.
            if (!current || current.version !== filters.version) {
              return { data: null, error: null };
            }
            state.battle = { ...current, ...patch } as typeof current;
            return { data: { space_id: SPACE }, error: null };
          }
          return { data: state.battle, error: null };
        }
        if (table === "concert_battle_rounds") {
          if (mode === "upsert") {
            state.roundUpserts.push({ ...patch });
            const number = Number(patch.round_number);
            const existing = state.rounds.find((r) => r.round_number === number);
            if (existing) Object.assign(existing, patch);
            else
              state.rounds.push(
                patch as unknown as ConcertRoundRow & Record<string, unknown>,
              );
            return { data: null, error: null };
          }
          if (mode === "update") {
            state.roundUpdates.push({ ...patch, __where: { ...filters } });
            const target = state.rounds.find(
              (r) =>
                r.round_number === Number(filters.round_number) &&
                (filters.state === undefined || r.state === filters.state),
            );
            if (target) Object.assign(target, patch);
            return { data: null, error: null };
          }
          return { data: state.rounds, error: null };
        }
        if (table === "gift_sends") {
          state.giftQueries.push({ ...range });
          const rows = state.gifts.filter(
            (g) =>
              (!range.gte || g.created_at >= range.gte) &&
              (!range.lt || g.created_at < range.lt),
          );
          return { data: rows, error: null };
        }
        return { data: null, error: null };
      }

      return builder;
    },
  };
}

function state(overrides: Partial<FakeState> = {}): FakeState {
  return {
    battle: battle(),
    rounds: [],
    gifts: [],
    battleUpdates: [],
    roundUpdates: [],
    roundUpserts: [],
    giftQueries: [],
    ...overrides,
  };
}

{
  const s = state();
  const outcome = await startConcertBattleRounds(fakeDb(s), SPACE, { nowMs: NOW });
  check("start writes a live round", outcome.applied === "round-started");
  check(
    "the round row is created active",
    s.roundUpserts.length === 1 && s.roundUpserts[0].state === "active",
  );
  check(
    "the battle moves to round_active with a real deadline",
    s.battle?.status === "round_active" &&
      s.battle?.phase_ends_at === iso(NOW + 240_000),
  );
  check("the battle version advances", s.battle?.version === 8);
}

{
  // Same battle, two callers, one transition.
  const s = state();
  const db = fakeDb(s);
  const first = await startConcertBattleRounds(db, SPACE, { nowMs: NOW });
  const stale = await startConcertBattleRounds(db, SPACE, { nowMs: NOW });
  check("the first start applies", first.applied === "round-started");
  check(
    "a second start after the state moved applies nothing",
    stale.applied === "none",
  );
}

{
  // The core scoring property. Round 1 was a blowout for the initiator; round 2
  // must be scored on round 2's gifts only.
  const roundTwoStart = NOW - 240_000;
  const s = state({
    battle: battle({
      status: "round_active",
      current_round: 2,
      phase_started_at: iso(roundTwoStart),
      phase_ends_at: iso(NOW - 1_000),
      version: 11,
    }),
    rounds: [
      round(1, {
        winner_id: INITIATOR,
        initiator_coins_total: 5_000,
        opponent_coins_total: 0,
      }),
      round(2, {
        state: "active",
        winner_id: null,
        starts_at: iso(roundTwoStart),
        ends_at: iso(NOW - 1_000),
        initiator_coins_total: 0,
        opponent_coins_total: 0,
      }),
    ],
    gifts: [
      // Round 1 money — must NOT count toward round 2.
      { target_id: INITIATOR, coins_spent: 5_000, created_at: iso(NOW - 600_000) },
      // Round 2 window.
      { target_id: OPPONENT, coins_spent: 40, created_at: iso(NOW - 120_000) },
      { target_id: OPPONENT, coins_spent: 20, created_at: iso(NOW - 100_000) },
      { target_id: INITIATOR, coins_spent: 30, created_at: iso(NOW - 90_000) },
      // An untargeted room tip scores for nobody.
      { target_id: null, coins_spent: 900, created_at: iso(NOW - 80_000) },
      { target_id: AUDIENCE, coins_spent: 900, created_at: iso(NOW - 80_000) },
    ],
  });

  const outcome = await advanceConcertBattle(fakeDb(s), SPACE, { nowMs: NOW });
  check("the expired round is finalized", outcome.applied === "round-finalized");
  check("round 2 is won by the opponent", outcome.winnerId === OPPONENT);
  check(
    "only the round's own window was queried",
    s.giftQueries.length === 1 &&
      s.giftQueries[0].gte === iso(roundTwoStart) &&
      s.giftQueries[0].lt === iso(NOW - 1_000),
  );
  const written = s.rounds.find((r) => r.round_number === 2);
  check(
    "the round stores its own window totals, not the battle's",
    written?.initiator_coins_total === 30 && written?.opponent_coins_total === 60,
  );
  check(
    "untargeted and non-competitor gifts are excluded",
    written?.initiator_gift_count === 1 && written?.opponent_gift_count === 2,
  );
  check(
    "the finalize write only touches an ACTIVE round",
    s.roundUpdates.length === 1 &&
      (s.roundUpdates[0].__where as Record<string, unknown>).state === "active",
  );
  check(
    "the battle moves to intermission",
    s.battle?.status === "round_intermission",
  );
  check(
    "the intermission has the declared deadline",
    typeof s.battle?.phase_ends_at === "string" &&
      Date.parse(s.battle.phase_ends_at as string) - NOW ===
        CONCERT_BATTLE_INTERMISSION_SECONDS * 1_000,
  );
}

{
  // Last round: finalize AND settle the battle in one transition, with the
  // just-decided round folded into the outcome.
  const s = state({
    battle: battle({
      status: "round_active",
      current_round: 3,
      phase_started_at: iso(NOW - 240_000),
      phase_ends_at: iso(NOW - 1_000),
      version: 3,
    }),
    rounds: [
      round(1, { winner_id: OPPONENT, initiator_coins_total: 0, opponent_coins_total: 10 }),
      round(2, { winner_id: INITIATOR, initiator_coins_total: 10, opponent_coins_total: 0 }),
      round(3, {
        state: "active",
        winner_id: null,
        starts_at: iso(NOW - 240_000),
        ends_at: iso(NOW - 1_000),
        initiator_coins_total: 0,
        opponent_coins_total: 0,
      }),
    ],
    gifts: [
      { target_id: OPPONENT, coins_spent: 75, created_at: iso(NOW - 60_000) },
    ],
  });

  const outcome = await advanceConcertBattle(fakeDb(s), SPACE, { nowMs: NOW });
  check("the final round completes the battle", outcome.applied === "battle-completed");
  check("the decider is credited to the round winner", outcome.winnerId === OPPONENT);
  check("the battle row is completed", s.battle?.status === "completed");
  check(
    "a completed battle carries a completion timestamp and reason",
    Boolean(s.battle?.completed_at) &&
      s.battle?.completion_reason === "regulation",
  );
  check(
    "a completed battle has no live deadline left",
    s.battle?.phase_ends_at === null,
  );
}

{
  // Intermission expired: the next round starts and its window is fresh.
  const s = state({
    battle: battle({
      status: "round_intermission",
      current_round: 1,
      phase_ends_at: iso(NOW - 500),
      version: 2,
    }),
    rounds: [round(1)],
  });
  const outcome = await advanceConcertBattle(fakeDb(s), SPACE, { nowMs: NOW });
  check(
    "an expired intermission starts round 2",
    outcome.applied === "round-started" && outcome.roundNumber === 2,
  );
  check(
    "round 2 gets its own fresh window",
    s.rounds.find((r) => r.round_number === 2)?.starts_at === iso(NOW),
  );
}

{
  // Nothing due: no writes at all. A cron running every minute must be inert.
  const s = state({
    battle: battle({
      status: "round_active",
      current_round: 1,
      phase_started_at: iso(NOW - 10_000),
      phase_ends_at: iso(NOW + 200_000),
    }),
    rounds: [
      round(1, {
        state: "active",
        winner_id: null,
        starts_at: iso(NOW - 10_000),
        ends_at: iso(NOW + 200_000),
      }),
    ],
  });
  const outcome = await advanceConcertBattle(fakeDb(s), SPACE, { nowMs: NOW });
  check("a mid-round tick applies nothing", outcome.applied === "none");
  check(
    "a mid-round tick writes nothing at all",
    s.battleUpdates.length === 0 &&
      s.roundUpdates.length === 0 &&
      s.roundUpserts.length === 0,
  );
}

{
  // Self-heal: battle says active, no round row exists.
  const s = state({
    battle: battle({
      status: "round_active",
      current_round: 1,
      phase_started_at: iso(NOW - 10_000),
      phase_ends_at: iso(NOW + 100_000),
    }),
    rounds: [],
  });
  const outcome = await advanceConcertBattle(fakeDb(s), SPACE, { nowMs: NOW });
  check("a missing round row is repaired", outcome.applied === "round-repaired");
  check(
    "the repaired round reuses the battle's own phase window",
    s.rounds[0]?.starts_at === iso(NOW - 10_000) &&
      s.rounds[0]?.ends_at === iso(NOW + 100_000),
  );
  check(
    "repairing does not touch the battle row",
    s.battleUpdates.length === 0,
  );
}

{
  const s = state({ battle: null });
  const outcome = await advanceConcertBattle(fakeDb(s), SPACE, { nowMs: NOW });
  check(
    "a missing battle is reported, not thrown",
    outcome.applied === "none" && outcome.reason === "not-found",
  );
}

}

applierContracts().then(() => {
  console.log(
    failures === 0
      ? "\nAll Concert round lifecycle contracts hold.\n"
      : `\n${failures} Concert round lifecycle contract(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
});
