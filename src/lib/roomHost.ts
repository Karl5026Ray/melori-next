import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  applyStagePermissions,
  endLiveKitRoom,
  livekitConfigured,
} from "@/lib/livekitServer";
import { publishSystemSignal } from "@/lib/pubnubServer";

// Server-authoritative HOST auto-promotion.
//
// Called from the places that detect a host leaving (the /leave beacon route and
// the PubNub presence webhook). The DB decides the successor atomically via the
// promote_next_host() RPC (029) — a FOR UPDATE lock on the spaces row means only
// ONE concurrent caller performs the transfer even if several host-left signals
// land at once. This module just mirrors the DB outcome onto LiveKit + notifies
// clients; it never picks the winner itself and never trusts a client.

type PromoteOutcome =
  | "promoted"
  | "ended-no-successor"
  | "already-promoted"
  | "not-live"
  | "not-found";

interface PromoteResult {
  outcome: PromoteOutcome;
  newHostId: string | null;
}

// Transfer host (or gracefully end the room) after the host disconnected.
// `departingHostId` is the user we believe left; the RPC re-checks it against
// the current host so a stale/duplicate signal can't demote a fresh host.
export async function promoteHostOnLeave(
  spaceId: string,
  departingHostId: string,
): Promise<PromoteResult> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("promote_next_host", {
    p_space_id: spaceId,
    p_departing_host: departingHostId,
  });
  if (error) {
    console.warn("[roomHost] promote_next_host failed", error.message);
    return { outcome: "not-found", newHostId: null };
  }

  // The RPC returns a single-row table: [{ new_host_id, outcome }].
  const row = Array.isArray(data) ? data[0] : data;
  const outcome = (row?.outcome ?? "not-found") as PromoteOutcome;
  const newHostId = (row?.new_host_id ?? null) as string | null;

  if (outcome === "promoted" && newHostId) {
    await onPromoted(supabase, spaceId, newHostId);
  } else if (outcome === "ended-no-successor") {
    await onGracefulEnd(supabase, spaceId);
  }

  return { outcome, newHostId };
}

// Give the freshly-promoted host their host permissions on LiveKit (canPublish +
// host metadata) so they can speak / moderate without a rejoin, then tell the
// room who the new host is.
async function onPromoted(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  spaceId: string,
  newHostId: string,
): Promise<void> {
  const { data: space } = await supabase
    .from("spaces")
    .select("id, livekit_room, room_format")
    .eq("id", spaceId)
    .maybeSingle();

  if (space && livekitConfigured()) {
    const roomName: string = space.livekit_room ?? `space_${space.id}`;
    const withVideo = String(space.room_format ?? "").startsWith("live_");

    const { data: avatarRow } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", newHostId)
      .maybeSingle();
    const avatarUrl =
      (avatarRow as { avatar_url?: string | null } | null)?.avatar_url ?? null;

    await applyStagePermissions({
      roomName,
      identity: newHostId,
      onStage: true,
      withVideo,
      socialRole: "host",
      avatarUrl,
    });
  }

  // Let every client update badges / controls live (the new host's own client
  // also re-reads its role and shows host controls).
  await publishSystemSignal(spaceId, {
    event: "host-changed",
    host_id: newHostId,
  });
}

// No eligible successor: the RPC already flipped the room to 'ended' and marked
// participants left. Disconnect any LiveKit stragglers and surface the clean
// "room ended" state to clients.
async function onGracefulEnd(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  spaceId: string,
): Promise<void> {
  if (livekitConfigured()) {
    const { data: space } = await supabase
      .from("spaces")
      .select("id, livekit_room")
      .eq("id", spaceId)
      .maybeSingle();
    if (space) {
      const roomName: string = space.livekit_room ?? `space_${space.id}`;
      await endLiveKitRoom(roomName);
    }
  }

  await publishSystemSignal(spaceId, {
    event: "space-ended",
    reason: "host-left-no-successor",
  });
}
