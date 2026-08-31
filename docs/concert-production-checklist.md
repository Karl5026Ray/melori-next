# Concert production checklist

What has to be true before two artists can actually run a live battle on
melorimusic.org, why each item matters, and how to verify it.

Concert's failure modes are quiet. If LiveKit credentials are wrong, both
competitors sit on "Waiting for their camera" and the page reports nothing
wrong. If the gift/score migration is missing, every score reads as zero —
indistinguishable from an audience that has not gifted yet. Neither shows up in
a build, a typecheck, or the test suite. Hence this list and the preflight
script that automates it.

## One command

```bash
npx vercel env pull .env.production.local   # pull the real production values
npm run verify:concert -- --live            # env + database + LiveKit handshake
```

Exit code 0 means a battle can connect and score. Non-zero prints exactly which
item is wrong and what to do about it. Without `--live` the script checks that
credentials are *present*; with `--live` it also proves they are *accepted* by
calling LiveKit's read-only `listRooms`. A rotated secret looks perfectly
configured until something actually signs a request with it.

The decision logic is `src/lib/concertReadiness.ts`, covered by
`scripts/concert-readiness.test.ts` (part of `npm run test:unit`). An
unreachable database reports "unknown" and blocks — a probe that could not run
is not evidence of health.

## 1. Database — migration 066

`supabase/migrations/066_concert_instrument_gifts_and_scores.sql` provides:

- the five instrument gifts the battle tray offers (`battle_guitar`,
  `battle_piano`, `battle_drum`, `battle_violin`, `battle_saxophone`), whose
  `price_coins` the client renders and never hardcodes;
- `public.concert_battle_gift_totals(uuid)`, the server-authoritative score
  aggregate behind the battle status bar;
- `gift_sends_space_target_idx`, which keeps that aggregate from scanning
  `gift_sends` unindexed as gift volume grows.

Applied to production on 2026-08-14. Verified afterwards: five gift rows active
at 15/20/30/40/60 coins, the function present as `SECURITY DEFINER` + `STABLE`,
and `EXECUTE` held only by `service_role` (plus the `postgres` owner) —
`anon` and `authenticated` are revoked, matching the Concert lockdown from
migration 062. The preflight re-checks that grant, because a
`SECURITY DEFINER` aggregate leaked to `authenticated` would let any signed-in
client read any space's gift totals directly, bypassing the API routes.

> Prefix note: this migration was authored as 065 and renumbered to 066.
> Prefix 065 had already been spent by an out-of-band production hotfix
> (`065_fix_null_auth_tokens`, applied 2026-08-13) that was never checked in.
> That hotfix is now captured in the repo verbatim from the ledger so the
> repository and production agree. See `scripts/migration-prefix.test.ts`.

## 2. LiveKit server credentials

| Variable | Where it comes from |
| --- | --- |
| `LIVEKIT_URL` | The LiveKit Cloud project's `wss://…livekit.cloud` URL |
| `LIVEKIT_API_KEY` | LiveKit Cloud → Settings → Keys |
| `LIVEKIT_API_SECRET` | Shown **once**, at key creation |

All three are set on Vercel Production (added 2026-07-11, shared with the MM
Social and Cinema room stack — Concert introduces no new LiveKit
configuration). If the secret is ever lost, create a new key and update the key
and secret **together**; a mismatched pair authenticates as nothing.

Known gap: none of these cover the **Preview** environment, so a battle opened
on a preview deployment cannot connect a camera even though the page renders.
Preview coverage needs a fresh LiveKit key, since Vercel cannot reveal an
existing secret for copying.

## 3. `CRON_SECRET`

Set on Vercel Production (added 2026-07-21). **This is now load-bearing for
Concert.** `/api/cron/concert-battle-rounds` runs every minute and is the
backstop that finalizes an expired round, opens the intermission, starts the
next round, and completes the battle. Competitors' clients call
`POST /api/concert/battles/:spaceId/rounds` with `{"action":"advance"}` the
instant their countdown hits zero, so in the normal case a round ends
immediately — but if both competitors' tabs are backgrounded or drop, the cron
is the only thing that moves the battle. An unset or wrong `CRON_SECRET` makes
that route return 403 and rounds can hang at 00:00.

Every other scheduled route in `vercel.json`
(`mm-presence-reap`, `mm-social-prune`, `dm-email-notifications`,
`photo-balance-reminders`, `/api/health`) rejects an unauthenticated call, so
an unset value silently disables room cleanup and presence reaping underneath
a live battle.

## 4. Still outstanding — not configuration

- ~~**Rounds do not advance on their own.**~~ CLOSED. The lifecycle now runs
  end to end: the host starts round 1 from the stage
  (`POST /api/concert/battles/:spaceId/rounds` `{"action":"start"}`), each
  expired round is finalized from the gift coins sent inside **that round's own
  window**, an intermission of `CONCERT_BATTLE_INTERMISSION_SECONDS` (60s)
  follows, and the last regulation round completes the battle. Rounds won decide
  the winner; a tie on rounds is broken on total coins; dead even is a draw.
  Two callers drive it — the competitors' clients for instant transitions and
  `/api/cron/concert-battle-rounds` once a minute as the guarantee — and every
  battle write is guarded by `concert_battles.version`, so simultaneous callers
  produce exactly one transition. Planning is pure (`src/lib/concertRounds.ts`)
  and pinned by `npm run test:concert-rounds`. No migration was required.
- **No real two-camera smoke test yet.** Everything is verified against
  request-mocked LiveKit. A production run with two authenticated accounts,
  two real cameras, and a real gift send has not happened. Watch for: both
  feeds publishing, an audience member being unable to obtain a camera, gift
  coins debiting once, and the score bar moving for both sides.
