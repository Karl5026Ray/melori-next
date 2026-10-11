import "server-only";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validators";
import { isAuditionFormat, type AccessStatus, type AuditionRoomFormat } from "@/lib/auditions";

// Server-side loader for every /api/auditions route. One place decides who the
// caller is to the room, so no route can forget the private-room check.

export const AUDITION_DOCS_BUCKET = "audition-docs";

export interface AuditionRoom {
  id: string;
  title: string;
  topic: string | null;
  host_id: string;
  status: string;
  room_format: AuditionRoomFormat;
  is_private: boolean;
  livekit_room: string | null;
  is_recording: boolean;
  recording_egress_id: string | null;
  created_at: string | null;
}

export interface AuditionContext {
  room: AuditionRoom;
  userId: string;
  isHost: boolean;
  /** Host, or a host-appointed mod/cohost currently in the room. */
  isDirector: boolean;
  access: AccessStatus | null;
  characterName: string | null;
  /** Host or admitted: allowed into the live room. */
  isInside: boolean;
}

const ROOM_COLUMNS =
  "id, title, topic, host_id, status, room_format, is_private, livekit_room, is_recording, recording_egress_id, created_at";

/**
 * Resolves the caller's relationship to an audition room, or a NextResponse to
 * return. A private room the caller has no claim on answers 404, not 403, so
 * its existence isn't confirmed to strangers.
 */
export async function loadAuditionContext(
  spaceId: unknown,
  userId: string,
): Promise<AuditionContext | NextResponse> {
  if (!isUuid(spaceId)) {
    return NextResponse.json({ error: "Invalid room" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  const { data: room, error } = await supabase
    .from("spaces")
    .select(ROOM_COLUMNS)
    .eq("id", spaceId)
    .maybeSingle<AuditionRoom>();
  if (error) {
    return NextResponse.json({ error: "Could not load the room" }, { status: 500 });
  }
  if (!room || !isAuditionFormat(room.room_format)) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const isHost = room.host_id === userId;
  const [{ data: accessRow }, { data: participant }] = await Promise.all([
    supabase
      .from("space_access")
      .select("status, character_name")
      .eq("space_id", room.id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("space_participants")
      .select("badge, left_at")
      .eq("space_id", room.id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const access = (accessRow?.status as AccessStatus | undefined) ?? null;
  const isMod =
    !participant?.left_at && (participant?.badge === "mod" || participant?.badge === "cohost");
  const isDirector = isHost || (isMod && access === "admitted");
  const isInside = isHost || access === "admitted";

  if (room.is_private && !isHost && (access === null || access === "denied")) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return {
    room,
    userId,
    isHost,
    isDirector,
    access,
    characterName: accessRow?.character_name ?? null,
    isInside,
  };
}

export function isContextFailure(
  v: AuditionContext | NextResponse,
): v is NextResponse {
  return v instanceof NextResponse;
}

export function directorOnly(ctx: AuditionContext): NextResponse | null {
  return ctx.isDirector
    ? null
    : NextResponse.json({ error: "Only the director can do that" }, { status: 403 });
}

/**
 * For the generic /api/social/spaces/[id]/* read routes, which use the service
 * role and so bypass the private-room RLS from migration 094. Returns a 404 to
 * send back when the room is private and the caller is neither its host nor
 * admitted; null otherwise (every non-private room passes untouched).
 */
export async function refusePrivateRoomRead(
  spaceId: string,
  userId: string,
): Promise<NextResponse | null> {
  const supabase = getSupabaseAdmin();
  const { data: room } = await supabase
    .from("spaces")
    .select("host_id, is_private")
    .eq("id", spaceId)
    .maybeSingle();
  if (!room?.is_private || room.host_id === userId) return null;
  const { data: access } = await supabase
    .from("space_access")
    .select("status")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (access?.status === "admitted") return null;
  return NextResponse.json({ error: "Space not found" }, { status: 404 });
}
