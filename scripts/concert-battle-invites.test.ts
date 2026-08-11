/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  blockedMemberIds,
  filterVisibleMembers,
  safeMemberSearchTerm,
} from "@/lib/memberVisibility";
import { concertBattleErrorResponse } from "@/lib/concertBattleApi";
import { isUuid } from "@/lib/validators";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}`);
}

console.log("\nConcert opponent invitation pure invariants");
const blocks = [
  { blocker_id: "initiator", blocked_id: "blocked-by-me" },
  { blocker_id: "blocked-me", blocked_id: "initiator" },
];
const hidden = blockedMemberIds("initiator", blocks);
check("visibility hides self and both directions of a block", [
  "initiator",
  "blocked-by-me",
  "blocked-me",
].every((id) => hidden.has(id)));
const visible = filterVisibleMembers(
  [
    { id: "initiator", status: "active", deleted_at: null },
    { id: "blocked-by-me", status: "active", deleted_at: null },
    { id: "blocked-me", status: "active", deleted_at: null },
    { id: "inactive", status: "suspended", deleted_at: null },
    { id: "deleted", status: "active", deleted_at: "2026-08-10T00:00:00.000Z" },
    { id: "eligible", status: "active", deleted_at: null },
  ],
  "initiator",
  blocks,
  new Set(["room-banned"]),
);
check("only active, non-deleted, unblocked candidates remain", visible.length === 1 && visible[0].id === "eligible");
check(
  "search delimiters cannot alter the PostgREST filter",
  !safeMemberSearchTerm("a%,()b").match(/[%,()]/),
);
check(
  "known locked-slot error is a conflict",
  concertBattleErrorResponse("concert_battle_opponent_locked").status === 409,
);
check(
  "unknown database errors do not leak through a successful response",
  concertBattleErrorResponse("raw internal failure").status === 500,
);
check(
  "malformed UUIDs are rejected before any invitation query or RPC",
  !isUuid("not-a-uuid") &&
    !isUuid("00000000-0000-0000-0000-not-a-uuid") &&
    isUuid("123e4567-e89b-12d3-a456-426614174000"),
);

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/061_concert_battle_invitations.sql"),
  "utf8",
);
const foundationMigration = readFileSync(
  join(root, "supabase/migrations/060_concert_battle_domain.sql"),
  "utf8",
);
const createRoute = readFileSync(
  join(root, "src/app/api/concert/battles/route.ts"),
  "utf8",
);
const battleRoute = readFileSync(
  join(root, "src/app/api/concert/battles/[spaceId]/route.ts"),
  "utf8",
);
const candidateRoute = readFileSync(
  join(root, "src/app/api/concert/battles/[spaceId]/candidates/route.ts"),
  "utf8",
);
const inviteRoute = readFileSync(
  join(root, "src/app/api/concert/battles/[spaceId]/invite/route.ts"),
  "utf8",
);
const inboxRoute = readFileSync(
  join(root, "src/app/api/concert/battle-invites/route.ts"),
  "utf8",
);
const responseRoute = readFileSync(
  join(root, "src/app/api/concert/battle-invites/[id]/route.ts"),
  "utf8",
);
const responseRpc = migration.slice(
  migration.indexOf("create function public.respond_concert_battle_invite"),
  migration.indexOf("revoke all on function public.invite_concert_opponent"),
);

console.log("\nConcert opponent invitation server invariants");
check(
  "PR 2 is an append-only migration",
  migration.includes("APPEND-ONLY MIGRATION") &&
    migration.includes("061_concert_battle_invitations.sql"),
);
check(
  "invite creation locks envelope, battle, then pending invite",
  /from public\.spaces where id = p_space_id for update;[\s\S]*from public\.concert_battles[\s\S]*for update;[\s\S]*from public\.concert_battle_invites[\s\S]*status = 'pending'[\s\S]*for update;/.test(
    migration,
  ),
);
check(
  "a second pending invite is rejected instead of replaced",
  migration.includes("concert_battle_invite_pending") &&
    migration.includes("explicit cancel endpoint"),
);
check(
  "cancel and expiry have dedicated locked, idempotent RPCs",
  migration.includes("cancel_concert_battle_invite") &&
    migration.includes("expire_concert_battle_invites_for_recipient") &&
    migration.includes("expire_concert_battle_invite_for_space") &&
    migration.includes("return null;"),
);
check(
  "recipient response retries are idempotent, protects slot 2, and rechecks acceptance eligibility",
  migration.includes("v_invite.status = 'accepted'") &&
    migration.includes("p_action = 'accept'") &&
    migration.includes("v_battle.opponent_id = p_recipient_id") &&
    responseRpc.includes("outcome', 'accepted'") &&
    migration.includes("Eligibility is checked again at the irreversible acceptance transition") &&
    migration.includes("v_recipient.status is not null") &&
    foundationMigration.includes("concert battle opponent is immutable"),
);
check(
  "SQL and candidate route enforce inactive, deleted, blocked, and banned filters",
  migration.includes("concert_battle_recipient_inactive") &&
    migration.includes("concert_battle_recipient_banned") &&
    candidateRoute.includes('is("deleted_at", null)') &&
    candidateRoute.includes("filterVisibleMembers") &&
    candidateRoute.includes('from("space_bans")'),
);
check(
  "creation uses the atomic service-only RPC with token-derived identity",
  createRoute.includes("requireSuperfan") &&
    createRoute.includes('rpc("create_concert_battle"') &&
    createRoute.includes("p_initiator_id: initiatorId") &&
    !createRoute.includes("body.initiator"),
);
check(
  "invite endpoint accepts only a recipient target and validates again at mutation",
  inviteRoute.includes("recipient_id is required") &&
    inviteRoute.includes("filterVisibleMembers") &&
    inviteRoute.includes('rpc("invite_concert_opponent"') &&
    inviteRoute.includes("p_initiator_id: initiatorId"),
);
check(
  "recipient inbox is authenticated and expires durable rows before listing",
  inboxRoute.includes("requireAuth") &&
    inboxRoute.includes("expire_concert_battle_invites_for_recipient") &&
    inboxRoute.includes('.eq("recipient_id", recipientId)'),
);
check(
  "accept/decline derives recipient and space from the invite, not request JSON",
  responseRoute.includes("p_recipient_id: recipientId") &&
    responseRoute.includes('rpc(\n      "respond_concert_battle_invite"') &&
    !responseRoute.includes("body.space_id") &&
  !responseRoute.includes("body.opponent_id"),
);
check(
  "first acceptance requires a live Concert still awaiting its invited slot",
  /if v_space\.room_format is distinct from 'versus_battle'[\s\S]*or v_space\.status <> 'live'[\s\S]*or v_battle\.status <> 'invited'[\s\S]*or v_battle\.opponent_id is not null then[\s\S]*raise exception 'concert_battle_invite_not_pending';[\s\S]*end if;[\s\S]*update public\.concert_battle_invites[\s\S]*set status = 'accepted'/.test(
    migration,
  ),
);
check(
  "accepted retry returns before terminal-state guard and never rewrites battle state",
  (() => {
    const acceptedRetry = migration.indexOf("v_invite.status = 'accepted'");
    const terminalGuard = migration.indexOf(
      "if v_space.room_format is distinct from 'versus_battle'",
      migration.indexOf("This is deliberately after the accepted retry fast path"),
    );
    return acceptedRetry !== -1 &&
      terminalGuard !== -1 &&
      migration.indexOf("outcome', 'accepted'", acceptedRetry) < terminalGuard;
  })() &&
    /already accepted recipient remains a no-op even after the Concert\s+-- ends/.test(migration),
);
check(
  "expired response commits a distinguishable state instead of rolling back its durable transition",
  /drop function if exists public\.respond_concert_battle_invite\(uuid, uuid, text\);[\s\S]*returns jsonb/.test(
    migration,
  ) &&
    /if v_invite\.expires_at <= now\(\) then[\s\S]*update public\.concert_battle_invites set status = 'expired' where id = v_invite\.id;[\s\S]*return jsonb_build_object\('space_id', v_space_id, 'outcome', 'expired'\);/.test(
      responseRpc,
    ) &&
    !/if v_invite\.expires_at <= now\(\) then[\s\S]*raise exception 'concert_battle_invite_expired';/.test(
      responseRpc,
    ),
);
check(
  "expired retry is idempotent and keeps the released pending slot durable",
  /if v_invite\.status = 'expired' then[\s\S]*return jsonb_build_object\('space_id', v_space_id, 'outcome', 'expired'\);[\s\S]*end if;[\s\S]*if v_invite\.status <> 'pending'/.test(
    responseRpc,
  ) && /set status = 'expired'/.test(responseRpc),
);
check(
  "response API maps the committed expired outcome to the intended conflict",
  responseRoute.includes("function isInviteResponse") &&
    responseRoute.includes('data.outcome === "expired"') &&
    responseRoute.includes('concertBattleErrorResponse("concert_battle_invite_expired")') &&
    responseRoute.includes("status: mapped.status"),
);
check(
  "decline, cancellation, and expiry only restore selection for a live invited Concert",
  (migration.match(/v_space\.room_format = 'versus_battle'[\s\S]*?v_space\.status = 'live'[\s\S]*?v_battle\.opponent_id is null[\s\S]*?v_battle\.status = 'invited'/g) ?? [])
    .length >= 5,
);
check(
  "recipient expiry reconciliation visits spaces in deterministic order",
  /where recipient_id = p_recipient_id[\s\S]*and status = 'pending'[\s\S]*and expires_at <= now\(\)[\s\S]*order by space_id, id/.test(
    migration,
  ) && migration.includes("Every worker visits a recipient's expired rooms in one order"),
);
check(
  "database concurrency contract keeps every expiry mutation in envelope-to-battle-to-invite order",
  /for v_invite_id, v_space_id in[\s\S]*order by space_id, id[\s\S]*select \* into v_space from public\.spaces where id = v_space_id for update;[\s\S]*from public\.concert_battles[\s\S]*for update;[\s\S]*update public\.concert_battle_invites[\s\S]*where id = v_invite_id[\s\S]*and status = 'pending'/.test(
    migration,
  ),
);
check(
  "all request UUIDs are guarded before invitation service calls",
  [
    [createRoute, "initiatorId", 'rpc("create_concert_battle"'],
    [battleRoute, "spaceId", 'rpc(\n      "expire_concert_battle_invite_for_space"'],
    [candidateRoute, "spaceId", 'rpc(\n      "expire_concert_battle_invite_for_space"'],
    [inviteRoute, "spaceId", 'rpc("invite_concert_opponent"'],
    [inviteRoute, "recipientId", 'rpc("invite_concert_opponent"'],
    [inboxRoute, "recipientId", '"expire_concert_battle_invites_for_recipient"'],
    [responseRoute, "id", '"respond_concert_battle_invite"'],
  ].every(([route, id, call]) => {
    const guard = route.indexOf(`isUuid(${id})`);
    const serviceCall = route.indexOf(call);
    return guard !== -1 && serviceCall !== -1 && guard < serviceCall && route.includes("status: 400");
  }),
);

console.log(
  failures === 0
    ? "\nAll Concert opponent invitation assertions passed.\n"
    : `\n${failures} Concert opponent invitation assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
