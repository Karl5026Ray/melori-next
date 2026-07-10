# PubNub Ephemeral Presence — Backend Architecture

How MELORI Spaces guarantee that **a room truly vanishes the instant its last
participant leaves** — even if that participant's tab crashes.

This layer is **additive**. Supabase Realtime still drives the live UI
(participant list, `is_speaking`, host mutes). Agora still carries the voice.
PubNub is added purely as the **authoritative occupancy signal** that ends
empty rooms in real time, closing the gap the old cron-only approach left open.

---

## 1. The problem it solves

Before PubNub, room ephemerality relied on two mechanisms:

| Mechanism | Trigger | Weakness |
| --- | --- | --- |
| `sendBeacon` / `keepalive` fetch on `pagehide` | Tab closes cleanly | Never fires if the tab **crashes**, loses power, or the network drops |
| Cron `reap_idle_spaces(30)` + `prune_ended_spaces(2)` | Hourly sweep | A dead room can linger **up to 30 min** (idle reap) before it ends |

So an abandoned room — last person's laptop slams shut mid-sentence — could
stay "live" and discoverable for half an hour. PubNub Presence removes that
window: PubNub itself tracks channel occupancy and emits a **server-side
webhook** on every join/leave/timeout. When occupancy hits zero we end the room
**immediately**.

---

## 2. Components

```
┌─────────────┐        subscribe(withPresence)         ┌──────────────┐
│  Browser    │ ───────────────────────────────────►   │   PubNub     │
│ space page  │        presence: join/leave            │  (presence)  │
│             │ ◄─────── system signals ──────────────  │              │
└─────┬───────┘                                          └──────┬───────┘
      │ POST /pubnub-auth (PAM token, Superfan-gated)           │
      │                                                          │ presence event
      ▼                                                          ▼  (occupancy)
┌─────────────────────────┐                        ┌───────────────────────────┐
│ Next.js route handlers  │                        │ PubNub Function / webhook  │
│  • /api/.../pubnub-auth │                        │  forwards event + secret   │
│  • /api/pubnub/         │  ◄──────────────────── │  to our webhook            │
│      presence-webhook   │   POST (signed)        └───────────────────────────┘
└─────────┬───────────────┘
          │ end_space_now(space_id)  (atomic, idempotent RPC)
          ▼
┌─────────────────────────┐
│ Supabase (Postgres)     │   spaces.status: live → ended
│  spaces                 │   space_participants.left_at set
│  space_participants     │   later: prune_ended_spaces() hard-deletes
└─────────────────────────┘
```

### Files added

| File | Role |
| --- | --- |
| `src/lib/pubnubServer.ts` | Server SDK: PAM token grants, `hereNow()` occupancy, webhook signature verify, channel naming. Holds the **secret key** — never shipped to the browser. |
| `src/lib/pubnubClient.ts` | Browser SDK singleton (mirrors `agoraClient.ts`): subscribe-with-presence, token renewal, clean leave. |
| `src/app/api/social/spaces/[spaceId]/pubnub-auth/route.ts` | Mints a per-space, per-user PAM token. Superfan-gated; host/speakers get publish rights, audience read-only. |
| `src/app/api/pubnub/presence-webhook/route.ts` | Receives PubNub presence events; ends the room when occupancy is genuinely zero. |
| `supabase/migrations/016_pubnub_ephemeral_presence.sql` | `end_space_now(space_id)` — atomic, guarded, idempotent `live → ended` transition. |

---

## 3. Channel model

Each Space maps 1:1 to a PubNub channel:

```
space-<spaceId>          e.g. space-123e4567-e89b-...
space-<spaceId>-pnpres   presence channel (auto, granted with the resource)
```

`spaceChannel()` / `spaceIdFromChannel()` in `pubnubServer.ts` are the single
source of truth for this mapping. The webhook uses `spaceIdFromChannel()` to
ignore any channel it doesn't own.

---

## 4. Join / presence flow

1. User taps **Join Space** → existing Supabase `space_participants` upsert.
2. The space page effect calls `pubnubJoin({ spaceId, uuid })`.
3. `pubnubClient` POSTs `/api/social/spaces/[spaceId]/pubnub-auth`:
   - `requireSuperfan` gate (same as Agora).
   - Looks up the space; must be `live` or `scheduled`.
   - Grants a **PAM v3 token** bound to `authorized_uuid = user.id`, scoped to
     read + presence on that one channel, write only if host/speaker.
4. Client subscribes with `withPresence: true`, `heartbeatInterval: 60`,
   `presenceTimeout: 300`. PubNub now counts this user in occupancy.
5. Presence events update a live **"N here"** pill in the room header.

Token TTL is 60 min; the client re-grants ~1 min before expiry, exactly like
the Agora token renewal.

---

## 5. Leave / vanish flow (the guarantee)

There are three ways a user leaves, all converging on the webhook:

| Exit | PubNub event | Latency |
| --- | --- | --- |
| Clicks **Leave** / navigates away | `leave` (explicit unsubscribe) | Immediate |
| Closes the tab cleanly (`pagehide`) | `leave` | Immediate |
| **Tab crashes / power loss / network death** | `timeout` after `presenceTimeout` | ≤ ~5 min |

PubNub forwards the event to `POST /api/pubnub/presence-webhook`. The handler:

1. **Verifies the signature** — HMAC-SHA256 of the raw body in
   `x-melori-signature`, or the shared secret in `x-melori-webhook-secret`
   (mirrors the `CRON_SECRET` pattern). Rejects everything else with 403.
2. Extracts `spaceId` from the channel; ignores non-`space-*` channels.
3. Skips `join` (a join can't empty a room).
4. For `leave`/`timeout`/`interval`/`state-change`, calls `endSpaceIfEmpty`:
   - Loads the space; acts only if `status === 'live'`.
   - **Race protection:** re-queries the true occupancy via
     `hereNow()` rather than trusting the event's own `occupancy`, because
     PubNub can coalesce/reorder events. If a late joiner is already present,
     the room is **not** ended.
   - If occupancy is genuinely `0`, calls the `end_space_now(space_id)` RPC.
5. Marks any lingering `space_participants.left_at`, and publishes a
   `space-ended` system signal so any straggler client bounces to the list.

### Why an RPC (`end_space_now`)?

- **Atomic + guarded:** `UPDATE ... WHERE id = ? AND status = 'live'`. A
  duplicate webhook delivery finds `status = 'ended'` and no-ops.
- **Idempotent return:** returns the space id only if *this* call performed the
  transition, else `NULL`. The webhook can distinguish "I ended it" from
  "already ended".
- **Single authority:** the database — not the handler — owns the state
  transition, consistent with `reap_idle_spaces()` / `prune_ended_spaces()`.

---

## 6. Defense in depth

PubNub makes the **end** immediate, but the existing safety nets remain and are
complementary — nothing was removed:

- `reap_idle_spaces(30)` — catches any room PubNub somehow missed (e.g. PubNub
  outage, webhook misconfig). Backstop, not primary.
- `prune_ended_spaces(2)` — hard-**deletes** ended rooms so the row physically
  disappears (the true "vanish"). PubNub ends; the prune erases.
- `sendBeacon` on `pagehide` — still fires the server-side `/leave` and the
  host-left auto-end, independent of PubNub.

Result: **end** latency drops from ≤30 min to **immediate** (clean exit) or
**≤5 min** (crash), while the DB remains the single source of truth.

---

## 7. Environment variables

```
# Agora (voice) — App ID public, certificate server-only
NEXT_PUBLIC_AGORA_APP_ID=
AGORA_APP_CERTIFICATE=

# PubNub (presence) — pub/sub keys public, SECRET key server-only
PUBNUB_PUBLISH_KEY=
PUBNUB_SUBSCRIBE_KEY=
PUBNUB_SECRET_KEY=
PUBNUB_WEBHOOK_SECRET=   # shared secret the PubNub Function forwards

# Cron safety-net
CRON_SECRET=
```

If PubNub keys are absent, `isPubNubConfigured()` is false: the auth route and
webhook return `503`, the client `joinPresence` fails soft (logged, non-fatal),
and the room still works on Supabase Realtime + Agora + cron — i.e. the app
degrades gracefully to its previous behavior.

---

## 8. PubNub-side setup (one-time)

1. Create a PubNub keyset with **Presence** and **Access Manager** enabled.
2. Set the presence timeout to 300s (matches the client).
3. Create a **PubNub Function** (type: *After Presence*) on the `space-*`
   channel pattern that POSTs the event to
   `https://melorimusic.org/api/pubnub/presence-webhook`, adding either:
   - header `x-melori-webhook-secret: <PUBNUB_WEBHOOK_SECRET>`, or
   - header `x-melori-signature: <HMAC-SHA256(rawBody, PUBNUB_WEBHOOK_SECRET)>`.
4. (Optional) enable the same on `interval` presence mode for very large rooms
   so occupancy is reported periodically instead of per-event.

---

## 9. Local testing (no live credentials needed)

**Deterministic logic test** — mocks Supabase + PubNub, exercises the exact
end-room decision rules (drain, crash-timeout, idempotency, race, join-noop):

```bash
npm run test:presence
# → 13 passed, 0 failed
```

**End-to-end against a running dev server** — fires a *signed* presence event
at the real webhook route:

```bash
npm run dev                      # in one terminal (with .env.local set)
npm run test:webhook <spaceId> leave 0
```

It prints the equivalent `curl` and the JSON response
(`{ ok, action, spaceId, ended, occupancy, reason }`).

---

## 10. Security notes

- The **secret key** and **webhook secret** live only in server env / route
  handlers (`server-only` import guard on `pubnubServer.ts`).
- PAM tokens are bound to `authorized_uuid`, so a token minted for user A can't
  be replayed by user B.
- Audience members receive read-only tokens: they can hear presence and system
  signals but cannot publish PubNub signals (raise-hand/reactions are
  host/speaker-gated at the token level, in addition to any UI gating).
- The webhook performs **no** state change on `GET` (used only for PubNub's
  endpoint-reachability check) and requires a valid signature on `POST`.
