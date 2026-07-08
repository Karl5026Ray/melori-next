import "server-only";
import PubNub from "pubnub";
import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// PubNub server-side client for MELORI Spaces ephemerality.
//
// WHY PUBNUB (alongside Supabase Realtime)
// ----------------------------------------
// Supabase Realtime drives the *live UI* (participant list, is_speaking, host
// mutes). It is great for that, but it does NOT give us a reliable
// server-to-server signal the instant a room empties. Our previous
// ephemerality relied on (a) a best-effort `sendBeacon` on tab close and
// (b) a cron sweep (`reap_idle_spaces` at 30 min idle, `prune_ended_spaces`).
// If the last participant's tab crashes, the room lingers until cron.
//
// PubNub Presence closes that gap. Every Space maps to a PubNub channel
// (`space-<spaceId>`). PubNub tracks occupancy natively and fires a
// server-side **Presence webhook** on join/leave/timeout. When occupancy of a
// room's channel hits zero, PubNub calls our webhook and we end the room
// immediately — no polling, no waiting for cron. `timeout` events (default
// heartbeat 300s / presence-timeout) catch crashed tabs that never sent an
// explicit leave.
//
// This module is server-only. The publish/subscribe keys can be public, but
// the SECRET key (used for PAM Access Manager grants and never shipped to the
// browser) must stay here.
// ---------------------------------------------------------------------------

const PUBLISH_KEY = process.env.PUBNUB_PUBLISH_KEY ?? "";
const SUBSCRIBE_KEY = process.env.PUBNUB_SUBSCRIBE_KEY ?? "";
const SECRET_KEY = process.env.PUBNUB_SECRET_KEY ?? "";
const WEBHOOK_SECRET = process.env.PUBNUB_WEBHOOK_SECRET ?? "";

export function isPubNubConfigured(): boolean {
  return Boolean(PUBLISH_KEY && SUBSCRIBE_KEY && SECRET_KEY);
}

// The canonical PubNub channel name for a space. Keep this the single source
// of truth so the webhook, the grant route, and the client all agree.
export function spaceChannel(spaceId: string): string {
  return `space-${spaceId}`;
}

// Reverse of spaceChannel — extract the space id from a PubNub channel name.
// Returns null for channels we don't own so the webhook can ignore them.
export function spaceIdFromChannel(channel: string): string | null {
  if (!channel.startsWith("space-")) return null;
  const id = channel.slice("space-".length);
  return id.length > 0 ? id : null;
}

let _server: PubNub | null = null;

// Server PubNub instance. `userId` is required by the SDK; for server use we
// pass a stable service identity. This instance holds the SECRET key so it can
// mint PAM tokens and publish system messages.
export function getPubNubServer(): PubNub {
  if (!isPubNubConfigured()) {
    throw new Error("PubNub is not configured (missing keys)");
  }
  if (!_server) {
    _server = new PubNub({
      publishKey: PUBLISH_KEY,
      subscribeKey: SUBSCRIBE_KEY,
      secretKey: SECRET_KEY,
      userId: "melori-spaces-server",
      // Keep the server client lean — it never subscribes.
      heartbeatInterval: 0,
    });
  }
  return _server;
}

// ---------------------------------------------------------------------------
// PAM v3 token grant.
//
// A member joining a space gets a short-lived token scoped to exactly:
//   - read + presence on that one space channel (so they can hear presence)
//   - write only if they are host/speaker (so audience can't publish signals)
//   - read/write on the presence channel (`-pnpres`) is granted automatically
//
// The token is bound to the caller's `authorizedUuid` so it can't be reused by
// another user. We keep TTL short (default 60 min) and the client re-grants on
// expiry, mirroring how the Agora token flow already works.
// ---------------------------------------------------------------------------
export async function grantSpaceToken(opts: {
  spaceId: string;
  uuid: string;
  canPublish: boolean;
  ttlMinutes?: number;
}): Promise<string> {
  const pubnub = getPubNubServer();
  const channel = spaceChannel(opts.spaceId);
  const ttl = Math.min(Math.max(opts.ttlMinutes ?? 60, 1), 60 * 6);

  const token = await pubnub.grantToken({
    ttl,
    authorized_uuid: opts.uuid,
    resources: {
      channels: {
        [channel]: {
          read: true, // subscribe + receive presence events
          write: opts.canPublish, // publish signals (raise-hand, reactions)
        },
      },
    },
  });
  return token;
}

// Publish a lightweight system signal into a space channel from the server
// (e.g. "host ended the room"). Best-effort; never throws into the caller.
export async function publishSystemSignal(
  spaceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const pubnub = getPubNubServer();
    await pubnub.publish({
      channel: spaceChannel(spaceId),
      message: { __system: true, ...payload },
    });
  } catch (err) {
    console.warn("publishSystemSignal failed", err);
  }
}

// Authoritative occupancy check via PubNub Presence hereNow(). Used by the
// webhook as a confirmation step: PubNub sometimes coalesces events, so before
// ending a room we re-query the true occupancy to avoid ending a room that a
// late joiner just entered (race protection).
export async function getChannelOccupancy(spaceId: string): Promise<number> {
  const pubnub = getPubNubServer();
  const res = await pubnub.hereNow({
    channels: [spaceChannel(spaceId)],
    includeUUIDs: false,
  });
  const ch = res.channels?.[spaceChannel(spaceId)];
  return ch?.occupancy ?? 0;
}

// ---------------------------------------------------------------------------
// Webhook signature verification.
//
// PubNub Functions / webhooks don't ship a built-in HMAC on the presence
// event body, so we protect the endpoint with a shared secret that the PubNub
// Function forwards as a header (`x-melori-webhook-secret`) AND an HMAC of the
// raw body (`x-melori-signature`) computed with PUBNUB_WEBHOOK_SECRET. Either
// check passing is sufficient; we prefer the HMAC when present. This mirrors
// the CRON_SECRET pattern already used by mm-social-prune.
// ---------------------------------------------------------------------------
export function verifyWebhook(rawBody: string, headers: Headers): boolean {
  if (!WEBHOOK_SECRET) return false;

  const sig = headers.get("x-melori-signature");
  if (sig) {
    const expected = createHmac("sha256", WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      /* fall through to the plain-secret check */
    }
  }

  const plain = headers.get("x-melori-webhook-secret");
  if (plain) {
    try {
      const a = Buffer.from(plain);
      const b = Buffer.from(WEBHOOK_SECRET);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  return false;
}
