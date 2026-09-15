import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import {
  applyStagePermissions,
  livekitConfigured,
  revokePublishedSources,
} from "@/lib/livekitServer";
import {
  decideRoomPublish,
  type CinemaReservation,
  type RoomMediaRole,
} from "@/lib/roomMediaPolicy";
import {
  DEFAULT_CINEMA_TALK_MODE,
  isCinemaTalkMode,
  toCinemaTalkMode,
  type CinemaTalkMode,
} from "@/lib/cinemaTalkModes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Talk mode for an MM Cinema room — who may be HEARD right now.
//
// GET — anyone may read the room's talk mode. It is rendered in the room UI
//       for every participant, and a guest has to know it to understand why
//       their mic is or is not live.
// PUT — ONLY the room's host or a moderator may change it.
//
// There is deliberately no RLS write policy on room_talk_state (migration
// 078), so this route is the single path to changing it. If a guest could
// write here, any guest could silence a live room or open every mic in it.
//
// Changing the mode does two things, in this order:
//   1. Writes the durable truth, so a late joiner and a reconnecting guest
//      both land on the same answer.
//   2. Reapplies LiveKit publish permission for everyone currently connected,
//      so the change takes effect in the room people are already sitting in
//      rather than only on their next join.

type ParticipantRow = {
  user_id: string;
  role: string | null;
  badge: string | null;
  host_muted: boolean | null;
  left_at: string | null;
};

function isModeratorRow(row: { role?: string | null; badge?: string | null } | null): boolean {
  if (!row) return false;
  return row.role === "host" || row.badge === "mod" || row.badge === "cohost";
}

function mediaRole(
  space: { host_id: string },
  row: { role?: string | null; badge?: string | null } | null,
  userId: string,
): RoomMediaRole {
  if (space.host_id === userId) return "host";
  if (row?.badge === "mod" || row?.badge === "cohost") return "moderator";
  return row?.role === "speaker" ? "speaker" : "audience";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("room_talk_state")
    .select("talk_mode, updated_at")
    .eq("space_id", spaceId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // No row is the normal case for a room that has never changed its mode —
  // including every room created before migration 078. Answer with the
  // default rather than 404, so the client has one code path.
  return NextResponse.json({
    talk_mode: toCinemaTalkMode(data?.talk_mode),
    updated_at: data?.updated_at ?? null,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const { userId: callerId } = await getRequestMembership(req);
  if (!callerId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: { talk_mode?: unknown };
  try {
    body = (await req.json()) as { talk_mode?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isCinemaTalkMode(body.talk_mode)) {
    return NextResponse.json(
      { error: "talk_mode must be one of: silent, intermission, commentary" },
      { status: 400 },
    );
  }
  const talkMode: CinemaTalkMode = body.talk_mode;

  const supabase = getSupabaseAdmin();

  // Authority is read from the DATABASE, never from anything the client sent.
  const { data: space, error: spaceErr } = await supabase
    .from("spaces")
    .select("id, host_id, status, room_format, livekit_room")
    .eq("id", spaceId)
    .maybeSingle();

  if (spaceErr) {
    return NextResponse.json({ error: spaceErr.message }, { status: 500 });
  }
  if (!space) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (space.room_format !== "cinema") {
    return NextResponse.json(
      { error: "This room is not a Cinema room" },
      { status: 409 },
    );
  }
  if (space.status === "ended") {
    return NextResponse.json({ error: "This room has ended" }, { status: 409 });
  }

  let callerIsMod = space.host_id === callerId;
  if (!callerIsMod) {
    const { data: callerRow } = await supabase
      .from("space_participants")
      .select("role, badge, left_at")
      .eq("space_id", spaceId)
      .eq("user_id", callerId)
      .maybeSingle();
    // A moderator who has left the room is not a moderator of it any more.
    callerIsMod =
      isModeratorRow(callerRow as ParticipantRow | null) &&
      !(callerRow as ParticipantRow | null)?.left_at;
  }
  if (!callerIsMod) {
    return NextResponse.json(
      { error: "Only the host or a moderator can change the talk mode" },
      { status: 403 },
    );
  }

  const { data: saved, error: writeErr } = await supabase
    .from("room_talk_state")
    .upsert(
      {
        space_id: spaceId,
        talk_mode: talkMode,
        updated_at: new Date().toISOString(),
        updated_by: callerId,
      },
      { onConflict: "space_id" },
    )
    .select("talk_mode, updated_at")
    .single();

  if (writeErr) {
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  // Reapply publish permission for everyone in the room. Unlike a camera-slot
  // change, which targets one person, a talk-mode change affects the whole
  // roster — so this is N updateParticipant calls, bounded by the room's
  // capacity. Best-effort: a LiveKit hiccup must not roll back the durable
  // write, because the token route re-derives permission from this same row on
  // the participant's next join.
  let livekitSynced = true;
  if (livekitConfigured()) {
    const roomName: string = space.livekit_room ?? `space_${space.id}`;

    const [{ data: roster }, { data: slotRows }] = await Promise.all([
      supabase
        .from("space_participants")
        .select("user_id, role, badge, host_muted, left_at")
        .eq("space_id", spaceId)
        .is("left_at", null),
      supabase
        .from("cinema_camera_slots")
        .select("slot, user_id")
        .eq("space_id", spaceId),
    ]);

    const reservations: CinemaReservation[] = (slotRows ?? []).map((row) => ({
      slot: Number((row as { slot: number }).slot),
      userId: String((row as { user_id: string }).user_id),
    }));

    const rows = (roster ?? []) as ParticipantRow[];
    const results = await Promise.all(
      rows.map(async (row) => {
        const role = mediaRole(space, row, row.user_id);
        const decision = decideRoomPublish({
          roomFormat: space.room_format,
          hostId: space.host_id,
          userId: row.user_id,
          role,
          hostMuted: Boolean(row.host_muted),
          reservations,
          requested: ["camera", "microphone"],
          talkMode,
        });

        const { data: avatarRow } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("id", row.user_id)
          .maybeSingle();

        const applied = await applyStagePermissions({
          roomName,
          identity: row.user_id,
          sources: decision.allowedSources,
          socialRole: role,
          avatarUrl:
            (avatarRow as { avatar_url?: string | null } | null)?.avatar_url ?? null,
        });

        // Permission first, then silence what is already open. Dropping the
        // grant stops NEW tracks; an in-flight microphone keeps transmitting
        // until it is explicitly muted, which is the whole point of Silent.
        if (!decision.allowedSources.includes("microphone")) {
          await revokePublishedSources(roomName, row.user_id, ["microphone"]);
        }
        return applied;
      }),
    );
    livekitSynced = results.every(Boolean);
  }

  return NextResponse.json({
    talk_mode: toCinemaTalkMode(saved?.talk_mode ?? talkMode),
    updated_at: saved?.updated_at ?? new Date().toISOString(),
    default_talk_mode: DEFAULT_CINEMA_TALK_MODE,
    livekit_synced: livekitSynced,
  });
}
