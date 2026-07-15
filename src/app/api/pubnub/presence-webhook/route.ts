import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isPubNubConfigured,
  verifyWebhook,
  spaceIdFromChannel,
  getChannelOccupancy,
  publishSystemSignal,
} from "@/lib/pubnubServer";
import { promoteHostOnLeave } from "@/lib/roomHost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/pubnub/presence-webhook
//
// THE room-vanish guarantee.
// --------------------------
// A PubNub Function (or Presence webhook) forwards every presence event on our
// `space-*` channels here. On any event that could drop occupancy to zero
// (`leave`, `timeout`, or an `interval`/`state-change` reporting occupancy 0),
// we confirm the true occupancy via hereNow() and, if genuinely empty, end the
// room immediately. This is what makes rooms "truly vanish once the last
// participant leaves" — even when the last tab crashed (caught by `timeout`).
//
// Idempotent: ending an already-ended space is a no-op. Safe to receive
// duplicate events.
//
// Expected body (PubNub presence event shape, flexible):
//   {
//     "channel": "space-<uuid>" | "channel_name",
//     "action":  "join" | "leave" | "timeout" | "interval" | "state-change",
//     "occupancy": <number>,
//     "uuid": "<user>",            // for join/leave/timeout
//     "timestamp": <number>
//   }
//
// Auth: HMAC of the raw body in `x-melori-signature` (preferred) OR the shared
// secret in `x-melori-webhook-secret`. See verifyWebhook().

interface PresenceEvent {
  channel?: string;
  channel_name?: string;
  action?: string;
  occupancy?: number;
  uuid?: string;
  timestamp?: number;
}

async function endSpaceIfEmpty(
  spaceId: string,
  reportedOccupancy: number | undefined,
): Promise<{ ended: boolean; occupancy: number; reason: string }> {
  const supabase = getSupabaseAdmin();

  // Only act on live rooms. Scheduled rooms have no presence yet; ended rooms
  // are already gone.
  const { data: space } = await supabase
    .from("spaces")
    .select("id, status")
    .eq("id", spaceId)
    .maybeSingle();

  if (!space) return { ended: false, occupancy: 0, reason: "not-found" };
  if (space.status !== "live") {
    return { ended: false, occupancy: 0, reason: `status-${space.status}` };
  }

  // Race protection: PubNub may coalesce/reorder events, so trust hereNow()
  // over the event's own occupancy when we can reach it. If hereNow() fails
  // (network), fall back to the event's reported occupancy.
  let occupancy = reportedOccupancy ?? 0;
  try {
    occupancy = await getChannelOccupancy(spaceId);
  } catch {
    /* keep reported occupancy */
  }

  if (occupancy > 0) {
    return { ended: false, occupancy, reason: "still-occupied" };
  }

  // Occupancy is zero → end the room now. Use the RPC so the DB is the single
  // authority and the transition is atomic (only flips a room that is still
  // 'live'). Also mark any lingering participant rows as left.
  const now = new Date().toISOString();
  const { data: endedId, error } = await supabase.rpc("end_space_now", {
    p_space_id: spaceId,
  });
  if (error) {
    // Fallback to a direct guarded update if the RPC isn't deployed yet.
    await supabase
      .from("spaces")
      .update({ status: "ended", ended_at: now })
      .eq("id", spaceId)
      .eq("status", "live");
  }
  await supabase
    .from("space_participants")
    .update({ left_at: now })
    .eq("space_id", spaceId)
    .is("left_at", null);

  // Tell any straggler clients (shouldn't be any) that the room is gone.
  await publishSystemSignal(spaceId, { event: "space-ended", reason: "empty" });

  return {
    ended: Boolean(endedId) || !error,
    occupancy: 0,
    reason: "ended-empty",
  };
}

export async function POST(req: NextRequest) {
  if (!isPubNubConfigured()) {
    return NextResponse.json(
      { error: "PubNub is not configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  if (!verifyWebhook(rawBody, req.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let evt: PresenceEvent;
  try {
    evt = JSON.parse(rawBody) as PresenceEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const channel = evt.channel ?? evt.channel_name ?? "";
  const spaceId = spaceIdFromChannel(channel);
  if (!spaceId) {
    // Not one of our space channels — ack and ignore.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const action = evt.action ?? "";
  // Only leave/timeout/interval/state-change can drop occupancy. `join` never
  // empties a room, so we skip the (cheap but pointless) hereNow() call.
  const mayEmpty =
    action === "leave" ||
    action === "timeout" ||
    action === "interval" ||
    action === "state-change";

  if (!mayEmpty) {
    return NextResponse.json({ ok: true, action, checked: false });
  }

  // If the specific participant who left/timed-out is the room's HOST, hand the
  // room off server-side (oldest moderator → oldest speaker → graceful end)
  // BEFORE the emptiness check. promoteHostOnLeave() is atomic + idempotent, so
  // the duplicate signals a single disconnect produces (browser beacon +
  // PubNub timeout + interval) can only ever promote one successor.
  let hostPromotion:
    | { outcome: string; newHostId: string | null }
    | undefined;
  if ((action === "leave" || action === "timeout") && evt.uuid) {
    const supabase = getSupabaseAdmin();
    const { data: space } = await supabase
      .from("spaces")
      .select("host_id, status")
      .eq("id", spaceId)
      .maybeSingle();
    if (space && space.status === "live" && space.host_id === evt.uuid) {
      hostPromotion = await promoteHostOnLeave(spaceId, evt.uuid);
    }
  }

  const result = await endSpaceIfEmpty(spaceId, evt.occupancy);
  return NextResponse.json({ ok: true, action, spaceId, hostPromotion, ...result });
}

// PubNub's webhook validation sometimes issues a GET to confirm the endpoint
// is reachable. Answer it without requiring the secret so setup is smooth,
// but never perform any state change on GET.
export async function GET() {
  return NextResponse.json({ ok: true, service: "melori-pubnub-presence" });
}
