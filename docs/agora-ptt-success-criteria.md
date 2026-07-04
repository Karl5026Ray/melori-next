# Agora PTT Audio Launch — Success Criteria & Instrumentation Brief

**Owner:** Karl Ray
**Tracking:** Milestone [Agora PTT Audio Launch](https://github.com/Karl5026Ray/melori-next/milestone/1), Project [Agora PTT Audio Launch](https://github.com/users/Karl5026Ray/projects/3)
**Scope:** Clubhouse rooms in `src/app/social/spaces/[spaceId]/page.tsx` + `agora-rtc-sdk-ng` client wiring
**Goal:** Have a data-driven signal — not vibes — that audio is ready before it goes to the full artist/listener base.

---

## 1. Quantitative Success Criteria

Each metric has a **target** (must pass to promote to all users) and a **guardrail** (auto-flag or block release if breached). Metrics are measured over a rolling 24 h window against ≥ 100 room sessions with ≥ 2 participants.

| # | Metric | Target (p95) | Guardrail (p99) | Why it matters |
|---|---|---|---|---|
| 1 | **Join latency** — from user tap "Join" → local `connection-state-change` reaches `CONNECTED` | **< 500 ms** | < 1 500 ms | If artists wait > 0.5 s to enter their own room, the experience feels broken; > 1.5 s is a hard fail. |
| 2 | **First-audio latency** — for audience: from `join` → first `user-published` audio `subscribe` → `audioTrack.play()` returns | < 1 200 ms | < 2 500 ms | This is what a listener actually perceives as "the room started". |
| 3 | **Subscriber packet loss** — `getRemoteAudioStats()[uid].receivePacketsLost / receivePackets` per remote user per session | **< 1 %** | < 3 % | Above 1 % you get audible dropouts; above 3 % conversation breaks down. |
| 4 | **Publisher packet loss** — `getLocalAudioStats().sendPacketsLost / sendPackets` | < 1 % | < 3 % | Host-side loss = every listener suffers, so weighted heavier in the health score. |
| 5 | **End-to-end audio RTT** — `getRTCStats().RTT` while publishing/subscribing | < 250 ms | < 400 ms | Above 400 ms hosts and speakers start talking over each other. |
| 6 | **Mute-state sync** — from `UPDATE space_participants.is_muted` commit → local `AgoraRTC.LocalAudioTrack.setMuted()` reflects the same value | **< 200 ms** | < 500 ms | The UI mute indicator must match reality or artists will accidentally broadcast. |
| 7 | **Join success rate** — sessions where `connection-state-change` reaches `CONNECTED` within 5 s / total join attempts | **≥ 99 %** | ≥ 97 % | Direct measure of "does it work at all". |
| 8 | **Reconnect success rate** — after a `DISCONNECTED → RECONNECTING`, fraction that return to `CONNECTED` without a manual retry | ≥ 98 % | ≥ 95 % | Mobile users switch networks constantly; silent recovery is the whole point of Agora. |
| 9 | **Token-renewal success rate** — `token-privilege-will-expire` events answered by a successful `renewToken()` before `token-privilege-did-expire` fires | **100 %** | ≥ 99 % | A single miss = room goes silent mid-session. Zero-tolerance metric. |
| 10 | **Mic-permission-denied graceful handling** — sessions where `getUserMedia` throws and the room stays usable in listen-only mode (no crash, banner shown) | 100 % | 100 % | If we crash instead of degrading, users blame the app, not the browser prompt. |
| 11 | **Volume indicator responsiveness** — median lag between local voice onset and `volume-indicator` reporting `volume > 5` for that uid | < 300 ms | < 600 ms | Speaking rings on stage tiles feel dead if this drifts. |
| 12 | **Client CPU during 30-min room** — `performance.now()`-based sampling, or Chrome's `performance.measureUserAgentSpecificMemory` proxy | Median < 15 % on a 2020 mid-range laptop | < 30 % | Audio-only rooms should be cheap; higher means we're leaking tracks. |

**Composite health score** (used as the go/no-go gate):
```
health = 0.30·join_success + 0.25·(1 - subscriber_loss) + 0.20·(1 - publisher_loss)
       + 0.10·reconnect_success + 0.10·token_renewal_success + 0.05·mute_sync_ok
```
Promote to full user base when `health ≥ 0.97` sustained over 24 h with ≥ 100 sessions.

---

## 2. Instrumentation Plan

All instrumentation lives in the Agora client singleton created in issue [#6](https://github.com/Karl5026Ray/melori-next/issues/6) (`src/lib/agoraClient.ts`) plus a thin telemetry sink. Metrics are batched client-side and POSTed to a new `/api/telemetry/rtc` endpoint every 10 s (or on `pagehide` via `navigator.sendBeacon`). Rows land in a new `rtc_events` Supabase table for later aggregation.

### 2.1 Event surface we tap (Agora Web SDK v4.x)

| Metric # | Agora API |
|---|---|
| 1, 7, 8 | `client.on('connection-state-change', (curState, prevState, reason) => …)` — track transitions and timestamps |
| 2 | `client.on('user-published', ...)` combined with an `audioTrack.play()` resolve timestamp |
| 3 | `client.getRemoteAudioStats()` polled every 2 s → per-uid `receivePacketsLost`, `receivePackets`, `totalDuration` |
| 4 | `client.getLocalAudioStats()` polled every 2 s → `sendPacketsLost`, `sendPackets`, `sendBitrate` |
| 5 | `client.getRTCStats()` polled every 2 s → `RTT`, `OutgoingAvailableBandwidth` |
| 6 | Compare local `setMuted()` call timestamp with the Supabase realtime `postgres_changes` event timestamp for the same `is_muted` write |
| 9 | `client.on('token-privilege-will-expire', ...)` and `client.on('token-privilege-did-expire', ...)` |
| 10 | `try/catch` around `AgoraRTC.createMicrophoneAudioTrack` — catch `NotAllowedError` / `NotFoundError` |
| 11 | `client.enableAudioVolumeIndicator()` + `client.on('volume-indicator', …)` @ 200 ms cadence |
| 12 | Sampled with `performance.now()` deltas around a fixed-work loop, or `chrome://tracing`-style CPU sampling if available |

### 2.2 New telemetry table

```sql
-- New migration: supabase/migrations/004_rtc_events.sql
CREATE TABLE public.rtc_events (
  id           BIGSERIAL PRIMARY KEY,
  session_id   UUID NOT NULL,             -- one per room join, generated client-side
  space_id     UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  role         TEXT CHECK (role IN ('host','speaker','audience')),
  event_type   TEXT NOT NULL,             -- see enum below
  metric_key   TEXT,                       -- e.g. 'subscriber_loss_pct', 'join_latency_ms'
  metric_value DOUBLE PRECISION,
  remote_uid   TEXT,                       -- for per-remote-user metrics
  payload      JSONB,                      -- freeform for state change reasons, error codes
  ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.rtc_events(space_id, ts DESC);
CREATE INDEX ON public.rtc_events(session_id, event_type);
```

Event types we emit: `join_start`, `join_success`, `join_fail`, `first_audio`, `state_change`, `stats_tick`, `mute_local`, `mute_db_seen`, `token_will_expire`, `token_renewed`, `token_expired`, `permission_denied`, `reconnect_start`, `reconnect_success`, `leave`.

### 2.3 Client-side skeleton

```ts
// src/lib/rtcTelemetry.ts
import { supabase } from './supabaseClient';
const buffer: any[] = [];
export const sessionId = crypto.randomUUID();

export function emit(evt: string, extra: Record<string, unknown> = {}) {
  buffer.push({ session_id: sessionId, event_type: evt, ts: new Date().toISOString(), ...extra });
  if (buffer.length >= 20) flush();
}
async function flush() {
  if (!buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  await fetch('/api/telemetry/rtc', {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events: batch }),
  });
}
window.addEventListener('pagehide', () => {
  if (!buffer.length) return;
  navigator.sendBeacon('/api/telemetry/rtc', JSON.stringify({ events: buffer.splice(0) }));
});
setInterval(flush, 10_000);
```

```ts
// wiring inside agoraClient.ts (excerpt)
const joinStart = performance.now();
emit('join_start', { space_id: spaceId, role });

client.on('connection-state-change', (cur, prev, reason) => {
  emit('state_change', { from: prev, to: cur, reason });
  if (cur === 'CONNECTED' && prev !== 'CONNECTED') {
    emit('join_success', { metric_key: 'join_latency_ms',
                           metric_value: performance.now() - joinStart });
  }
});

let firstAudioLogged = false;
client.on('user-published', async (user, mediaType) => {
  if (mediaType !== 'audio') return;
  await client.subscribe(user, 'audio');
  user.audioTrack?.play();
  if (!firstAudioLogged) {
    firstAudioLogged = true;
    emit('first_audio', { metric_key: 'first_audio_latency_ms',
                          metric_value: performance.now() - joinStart,
                          remote_uid: String(user.uid) });
  }
});

// Poll stats every 2s — Agora recommends this exact cadence.
setInterval(async () => {
  const rtc    = client.getRTCStats();
  const local  = client.getLocalAudioStats();
  const remote = client.getRemoteAudioStats();
  emit('stats_tick', {
    metric_key: 'rtt_ms',            metric_value: rtc.RTT,
    payload: { local, remote }
  });
}, 2_000);

client.on('token-privilege-will-expire', async () => {
  emit('token_will_expire');
  const { token } = await fetchNewToken();
  await client.renewToken(token);
  emit('token_renewed');
});
client.on('token-privilege-did-expire', () => emit('token_expired'));

client.enableAudioVolumeIndicator();
client.on('volume-indicator', (vols) => {
  for (const v of vols) {
    if (v.level > 5) emit('speaking_tick', { remote_uid: String(v.uid),
                                             metric_key: 'volume', metric_value: v.level });
  }
});
```

### 2.4 Mute-sync timing (metric #6)

```ts
async function toggleMuteInstrumented(next: boolean) {
  const t0 = performance.now();
  await localAudioTrack.setMuted(next);
  emit('mute_local', { metric_value: next ? 1 : 0, payload: { at: t0 } });
  await supabase.from('space_participants')
    .update({ is_muted: next })
    .eq('space_id', spaceId).eq('user_id', userId);
}

// In the realtime subscription callback for space_participants:
supabase.channel(`space:${spaceId}`)
  .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'space_participants' },
      (payload) => {
    if (payload.new.user_id === userId && payload.new.is_muted !== undefined) {
      emit('mute_db_seen', { metric_key: 'mute_sync_ms',
                             metric_value: performance.now() - lastLocalMuteTs });
    }
  }).subscribe();
```

### 2.5 Aggregation & dashboard

Add a SQL view for the go/no-go dashboard:

```sql
CREATE OR REPLACE VIEW rtc_health_24h AS
WITH sessions AS (
  SELECT session_id, MIN(ts) AS started_at
  FROM rtc_events
  WHERE ts > now() - interval '24 hours'
  GROUP BY session_id
),
join_lat AS (
  SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY metric_value) AS p95_join_ms
  FROM rtc_events WHERE event_type='join_success' AND ts > now() - interval '24 hours'
),
sub_loss AS (
  SELECT avg((payload->'remote'->0->>'receivePacketsLost')::numeric
           / nullif((payload->'remote'->0->>'receivePackets')::numeric,0)) AS avg_loss
  FROM rtc_events WHERE event_type='stats_tick' AND ts > now() - interval '24 hours'
),
join_rate AS (
  SELECT (COUNT(*) FILTER (WHERE event_type='join_success'))::float /
         nullif(COUNT(*) FILTER (WHERE event_type='join_start'),0) AS rate
  FROM rtc_events WHERE ts > now() - interval '24 hours'
)
SELECT * FROM join_lat, sub_loss, join_rate;
```

A tiny `/admin/rtc-health` Next.js page can `SELECT * FROM rtc_health_24h` and render the health score plus a per-metric red/yellow/green traffic light, so you can eyeball readiness without opening SQL.

---

## 3. Rollout Gate

Do **not** promote past the current small artist test group until, over a **rolling 24 h** with **≥ 100 sessions**:

1. All 12 metrics above hit their p95 target.
2. Composite health score ≥ 0.97.
3. Zero `token_expired` events without a preceding `token_renewed`.
4. Zero unhandled `permission_denied` crashes (metric #10 = 100 %).
5. Manual QA matrix from issue [#17](https://github.com/Karl5026Ray/melori-next/issues/17) passes end-to-end.

If any of the above fail, keep the mic toggle behind a feature flag for the impacted user segment and file a follow-up issue against the milestone.

---

## 4. Sources

- [Agora Web SDK v4.x — `IAgoraRTCClient` reference (events, `getRTCStats`, `getLocalAudioStats`, `getRemoteAudioStats`, `enableAudioVolumeIndicator`)](https://api-ref.agora.io/en/video-sdk/web/4.x/interfaces/iagorartcclient.html)
- [Agora — Connection status management (`connection-state-change` / `onConnectionStateChanged` semantics)](https://docs.agora.io/en/interactive-live-streaming/enhance-call-quality/connection-status-management)
- [Agora — Report in-call statistics (2 s cadence for `onRtcStats`, `onLocalAudioStats`, `onRemoteAudioStats`)](https://docs.agora.io/en/3.x/voice-calling/advanced-features/in-call-quality)
- [Agora — Pre-call tests (`packetLossRate`, `jitter`, `availableBandwidth` from `onLastmileProbeResult`)](https://docs.agora.io/en/interactive-live-streaming/enhance-call-quality/pre-call-tests)
- [Agora Web SDK v4.x — `NetworkQuality` interface](https://api-ref.agora.io/en/video-sdk/web/4.x/interfaces/networkquality.html)
