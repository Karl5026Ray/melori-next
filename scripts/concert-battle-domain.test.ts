/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONCERT_BATTLE_ROOM_FORMAT,
  canConcertBattlePerform,
  formatConcertBattlePhaseTimer,
  formatConcertBattleTimer,
  getConcertBattleSecondsRemaining,
  getConcertBattleSlot,
  hasAcceptedConcertOpponent,
  isConcertBattleTerminal,
} from "@/lib/concertBattle";
import { roomHref } from "@/lib/cinema";

let failures = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}`);
}

function assertEq(name: string, actual: unknown, expected: unknown) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected));
}

console.log("\nConcert Battle pure invariants");
const battle = { initiator_id: "initiator", opponent_id: "opponent" };
assertEq("initiator always maps to slot 1", getConcertBattleSlot(battle, "initiator"), 1);
assertEq("accepted opponent always maps to slot 2", getConcertBattleSlot(battle, "opponent"), 2);
assertEq("viewer never receives a performer slot", getConcertBattleSlot(battle, "viewer"), null);
assertEq(
  "no opponent means slot 2 does not exist",
  getConcertBattleSlot({ initiator_id: "initiator", opponent_id: null }, "opponent"),
  null,
);
assertEq("opponent presence means accepted slot is available", hasAcceptedConcertOpponent(battle), true);
assertEq(
  "missing opponent remains unaccepted",
  hasAcceptedConcertOpponent({ initiator_id: "initiator", opponent_id: null }),
  false,
);
assertEq("ready competitors may perform", canConcertBattlePerform("ready"), true);
assertEq("round-active competitors may perform", canConcertBattlePerform("round_active"), true);
assertEq("selection does not grant performer media", canConcertBattlePerform("selecting_opponent"), false);
assertEq("completed battle is terminal", isConcertBattleTerminal("completed"), true);
assertEq("ready battle is not terminal", isConcertBattleTerminal("ready"), false);
assertEq("timer formats regulation seconds", formatConcertBattleTimer(240), "04:00");
assertEq("timer rounds up a display fraction", formatConcertBattleTimer(1.1), "00:02");
assertEq(
  "deadline countdown is display-only and clamps at zero",
  getConcertBattleSecondsRemaining("2026-01-01T00:00:01.000Z", Date.parse("2026-01-01T00:00:02.000Z")),
  0,
);
assertEq(
  "active phase timer uses its server-provided deadline",
  formatConcertBattlePhaseTimer(
    { status: "round_active", phase_ends_at: "2026-01-01T00:01:00.000Z" },
    Date.parse("2026-01-01T00:00:00.000Z"),
  ),
  "01:00",
);
assertEq(
  "non-active phase does not impersonate a running round",
  formatConcertBattlePhaseTimer(
    { status: "ready", phase_ends_at: "2026-01-01T00:01:00.000Z" },
    Date.parse("2026-01-01T00:00:00.000Z"),
  ),
  "--:--",
);
assertEq(
  "Concert room helper owns the dedicated route",
  roomHref({ id: "battle-room", room_format: CONCERT_BATTLE_ROOM_FORMAT }),
  "/social/concert/battle-room",
);

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/060_concert_battle_domain.sql"),
  "utf8",
);
const legacyRoute = readFileSync(
  join(root, "src/app/social/spaces/[spaceId]/page.tsx"),
  "utf8",
);
const concertRoute = readFileSync(
  join(root, "src/app/social/concert/[spaceId]/page.tsx"),
  "utf8",
);

console.log("\nConcert Battle database and route foundations");
check(
  "all three battle domain tables exist",
  /create table if not exists public\.concert_battles/.test(migration) &&
    /create table if not exists public\.concert_battle_rounds/.test(migration) &&
    /create table if not exists public\.concert_battle_invites/.test(migration),
);
check(
  "battle status and fixed regulation values are constrained",
  /'selecting_opponent'/.test(migration) &&
    /round_duration_seconds = 240/.test(migration) &&
    /regulation_rounds = 3/.test(migration),
);
check(
  "only a distinct accepted opponent can occupy slot 2",
  /concert_battles_distinct_competitors/.test(migration) &&
    /concert_battle_invites_one_accepted_per_battle/.test(migration) &&
    /concert_battle_invite_guard_before_write/.test(migration) &&
    /concert battle opponent requires an accepted invite/.test(migration),
);
check(
  "round winners are constrained to the two durable competitors",
  /concert_battle_round_identity_guard_before_write/.test(migration) &&
    /concert battle round winner must be a competitor/.test(migration),
);
check(
  "identity guard prevents initiator, opponent, and winner reassignment",
  /concert battle initiator is immutable/.test(migration) &&
    /concert battle opponent is immutable/.test(migration) &&
    /concert battle winner is immutable/.test(migration),
);
check(
  "generic host promotion cannot reassign an existing battle's slot 1",
  /create trigger concert_battle_space_guard_before_write/.test(migration) &&
    /concert battle initiator must remain the space host/.test(migration) &&
    /before update of host_id, room_format on public\.spaces/.test(migration),
);
check(
  "battle tables are RLS-protected with no client grants",
  /alter table public\.concert_battles enable row level security/.test(migration) &&
    /revoke all on table public\.concert_battles from anon, authenticated/.test(migration) &&
    !/grant .*concert_battles.*authenticated/i.test(migration),
);
check(
  "mutation RPCs are service-role-only",
  /revoke all on function public\.create_concert_battle/.test(migration) &&
    /grant execute on function public\.create_concert_battle[\s\S]*to service_role/.test(migration) &&
    /revoke all on function public\.invite_concert_opponent/.test(migration) &&
    /grant execute on function public\.respond_concert_battle_invite[\s\S]*to service_role/.test(migration),
);
check(
  "invite response serializes on the space before assigning an opponent",
  /perform 1 from public\.spaces where id = v_space_id for update;[\s\S]*from public\.concert_battle_invites[\s\S]*for update;[\s\S]*from public\.concert_battles[\s\S]*for update;/.test(
    migration,
  ),
);
check(
  "legacy Spaces URLs redirect Concert rooms before RoomScreen renders",
  legacyRoute.includes("CONCERT_BATTLE_ROOM_FORMAT") &&
    legacyRoute.includes("redirect(`/social/concert/${spaceId}`)") &&
    legacyRoute.indexOf("redirect(`/social/concert/${spaceId}`)") <
      legacyRoute.indexOf("return <RoomScreen"),
);
check(
  "Concert route is a dedicated boundary and does not render RoomScreen",
  concertRoute.includes("CONCERT_BATTLE_ROOM_FORMAT") &&
    concertRoute.includes("Generic Spaces") &&
    !/import\s+RoomScreen/.test(concertRoute) &&
    !/return\s+<RoomScreen/.test(concertRoute),
);

console.log(
  failures === 0
    ? "\nAll Concert Battle domain assertions passed.\n"
    : `\n${failures} Concert Battle domain assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
