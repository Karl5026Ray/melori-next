import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { deriveRoomName } from "@/lib/endRoom";
import { decideRoomPublish, type CinemaReservation, type RoomMediaRole } from "@/lib/roomMediaPolicy";
import {
  applyStagePermissions,
  livekitConfigured,
  revokePublishedSources,
  type SocialRole,
} from "@/lib/livekitServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SpaceRow = {
  id: string;
  host_id: string;
  room_format: string | null;
  status: string;
  livekit_room: string | null;
};

type ParticipantRow = {
  user_id: string;
  role: string | null;
  badge: string | null;
  host_muted: boolean | null;
  left_at: string | null;
};

function roleFor(space: SpaceRow, participant: ParticipantRow | null, userId: string): RoomMediaRole {
  if (userId === space.host_id) return "host";
  if (participant?.badge === "mod" || participant?.badge === "cohost") return "moderator";
  return participant?.role === "speaker" ? "speaker" : "audience";
}

function isModerator(space: SpaceRow, participant: ParticipantRow | null, userId: string): boolean {
  return (
    userId === space.host_id ||
    participant?.role === "host" ||
    participant?.badge === "mod" ||
    participant?.badge === "cohost"
  );
}

async function getReservations(spaceId: string): Promise<CinemaReservation[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("cinema_camera_slots")
    .select("slot, user_id")
    .eq("space_id", spaceId)
    .order("slot", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ slot: Number(row.slot), userId: String(row.user_id) }));
}

async function getSpace(spaceId: string): Promise<SpaceRow | null> {
  const { data } = await getSupabaseAdmin()
    .from("spaces")
    .select("id, host_id, room_format, status, livekit_room")
    .eq("id", spaceId)
    .maybeSingle<SpaceRow>();
  return data ?? null;
}

async function getParticipant(spaceId: string, userId: string): Promise<ParticipantRow | null> {
  const { data } = await getSupabaseAdmin()
    .from("space_participants")
    .select("user_id, role, badge, host_muted, left_at")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle<ParticipantRow>();
  return data ?? null;
}

async function applyCurrentPolicy(
  space: SpaceRow,
  targetId: string,
  participant: ParticipantRow | null,
  reservations: CinemaReservation[],
): Promise<{
  allowedSources: readonly ("camera" | "microphone")[];
  cameraSlot: number | null;
  runtimeApplied: boolean | null;
}> {
  const decision = decideRoomPublish({
    roomFormat: space.room_format,
    hostId: space.host_id,
    userId: targetId,
    role: roleFor(space, participant, targetId),
    hostMuted: Boolean(participant?.host_muted),
    reservations,
    requested: ["camera", "microphone"],
  });

  let runtimeApplied: boolean | null = null;
  if (livekitConfigured()) {
    runtimeApplied = await applyStagePermissions({
      roomName: deriveRoomName(space),
      identity: targetId,
      sources: decision.allowedSources,
      socialRole: roleFor(space, participant, targetId) as SocialRole,
    });
  }

  return {
    allowedSources: decision.allowedSources,
    cameraSlot: decision.cameraSlot,
    runtimeApplied,
  };
}

// GET is intentionally read-only and supports the public Cinema room shell:
// it exposes just slot/user mappings already visible in the room roster.
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await props.params;
  const space = await getSpace(spaceId);
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.room_format !== "cinema") {
    return NextResponse.json({ error: "This room is not a Cinema room" }, { status: 409 });
  }
  try {
    return NextResponse.json({ reservations: await getReservations(space.id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read camera slots" },
      { status: 500 },
    );
  }
}

// POST claims a durable camera reservation. A speaker may claim their own
// guest seat; host/moderator can assign one to another on-stage participant.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ spaceId: string }> },
) {
  const { userId: callerId } = await getRequestMembership(req);
  if (!callerId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { spaceId } = await props.params;
  const space = await getSpace(spaceId);
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.room_format !== "cinema") {
    return NextResponse.json({ error: "This room is not a Cinema room" }, { status: 409 });
  }
  if (space.status === "ended") {
    return NextResponse.json({ error: "This room has ended" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const targetId = typeof body?.user_id === "string" && body.user_id ? body.user_id : callerId;
  const caller = await getParticipant(space.id, callerId);
  if (targetId !== callerId && !isModerator(space, caller, callerId)) {
    return NextResponse.json({ error: "Host or moderator only" }, { status: 403 });
  }

  const target = targetId === space.host_id ? null : await getParticipant(space.id, targetId);
  const targetRole = roleFor(space, target, targetId);
  if (targetRole === "audience" || target?.host_muted) {
    return NextResponse.json(
      { error: "Only an unmuted host, moderator, or speaker can use a Cinema camera" },
      { status: 409 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_cinema_camera_slot", {
    p_space_id: space.id,
    p_user_id: targetId,
    p_assigned_by: callerId,
  });
  if (claimError) {
    const status = /not eligible|only valid for Cinema/i.test(claimError.message) ? 409 : 500;
    return NextResponse.json({ error: claimError.message }, { status });
  }
  if (!Array.isArray(claimed) || claimed.length === 0) {
    return NextResponse.json({ error: "All Cinema guest camera slots are occupied" }, { status: 409 });
  }

  const created = Boolean(claimed[0].created);
  try {
    // Re-read after the locked RPC. The database also prunes a reservation in
    // the same transaction as any concurrent mute/demotion/removal.
    const currentTarget = targetId === space.host_id ? null : await getParticipant(space.id, targetId);
    const reservations = await getReservations(space.id);
    const media = await applyCurrentPolicy(space, targetId, currentTarget, reservations);
    if (
      !media.allowedSources.includes("camera") ||
      (livekitConfigured() && media.runtimeApplied !== true)
    ) {
      throw new Error("Camera permission could not be granted");
    }
    // Close the runtime race: moderation may commit while LiveKit is applying
    // the grant. Re-check after the grant; if eligibility or ownership changed,
    // revoke the camera before this request can report success while preserving
    // the participant's microphone-only Cinema connection.
    const verifiedTarget =
      targetId === space.host_id ? null : await getParticipant(space.id, targetId);
    const verifiedReservations = await getReservations(space.id);
    const verified = decideRoomPublish({
      roomFormat: space.room_format,
      hostId: space.host_id,
      userId: targetId,
      role: roleFor(space, verifiedTarget, targetId),
      hostMuted: Boolean(verifiedTarget?.host_muted),
      reservations: verifiedReservations,
      requested: ["camera", "microphone"],
    });
    if (!verified.allowedSources.includes("camera")) {
      await applyCurrentPolicy(space, targetId, verifiedTarget, verifiedReservations);
      if (livekitConfigured()) {
        await revokePublishedSources(deriveRoomName(space), targetId, ["camera"]);
      }
      throw new Error("Camera permission changed while the slot was being claimed");
    }
    return NextResponse.json({
      reservation: { slot: Number(claimed[0].slot), userId: targetId },
      reservations: verifiedReservations,
      allowed_sources: verified.allowedSources,
      camera_slot: verified.cameraSlot,
    });
  } catch (error) {
    let runtimeSafeToRelease = true;
    let runtimeCleanupError: string | null = null;
    if (created && livekitConfigured()) {
      try {
        const cleanupTarget =
          targetId === space.host_id ? null : await getParticipant(space.id, targetId);
        const cleanupReservations = (await getReservations(space.id)).filter(
          (reservation) => reservation.userId !== targetId,
        );
        await applyCurrentPolicy(space, targetId, cleanupTarget, cleanupReservations);
        await revokePublishedSources(deriveRoomName(space), targetId, ["camera"]);
      } catch (cleanupError) {
        runtimeSafeToRelease = false;
        runtimeCleanupError =
          cleanupError instanceof Error ? cleanupError.message : "LiveKit cleanup failed";
      }
    }
    if (created && runtimeSafeToRelease) {
      const { error: releaseError } = await supabase.rpc("release_cinema_camera_slot", {
        p_space_id: space.id,
        p_user_id: targetId,
      });
      if (releaseError) {
        return NextResponse.json(
          { error: `Camera grant failed and its reservation could not be released: ${releaseError.message}` },
          { status: 500 },
        );
      }
    }
    const message = error instanceof Error ? error.message : "Could not apply camera permission";
    if (!runtimeSafeToRelease) {
      return NextResponse.json(
        {
          error: `${message}; the reservation was retained because runtime cleanup failed: ${runtimeCleanupError}`,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: message },
      { status: message === "Camera permission could not be granted" ? 409 : 500 },
    );
  }
}

// DELETE releases a guest camera reservation and immediately removes camera
// permission from a connected participant. Host slot zero is intentionally
// retained across transient host reconnects.
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ spaceId: string }> },
) {
  const { userId: callerId } = await getRequestMembership(req);
  if (!callerId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { spaceId } = await props.params;
  const space = await getSpace(spaceId);
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.room_format !== "cinema") {
    return NextResponse.json({ error: "This room is not a Cinema room" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const targetId = typeof body?.user_id === "string" && body.user_id ? body.user_id : callerId;
  const caller = await getParticipant(space.id, callerId);
  if (targetId !== callerId && !isModerator(space, caller, callerId)) {
    return NextResponse.json({ error: "Host or moderator only" }, { status: 403 });
  }
  if (targetId === space.host_id) {
    return NextResponse.json({ error: "The host's reserved camera slot cannot be released" }, { status: 409 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const target = await getParticipant(space.id, targetId);
    const reservationsBeforeRelease = await getReservations(space.id);
    const policyWithoutTargetSlot = reservationsBeforeRelease.filter(
      (reservation) => reservation.userId !== targetId,
    );
    // Fail closed: first remove runtime camera authorization and mute any
    // published camera track. Preserve microphone-only participation, and only
    // then free the durable slot for another guest.
    await applyCurrentPolicy(space, targetId, target, policyWithoutTargetSlot);
    if (livekitConfigured()) {
      await revokePublishedSources(deriveRoomName(space), targetId, ["camera"]);
    }
    const { error: releaseError } = await supabase.rpc("release_cinema_camera_slot", {
      p_space_id: space.id,
      p_user_id: targetId,
    });
    if (releaseError) throw new Error(releaseError.message);
    const reservations = await getReservations(space.id);
    return NextResponse.json({ ok: true, reservations });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not revoke camera permission" },
      { status: 500 },
    );
  }
}
