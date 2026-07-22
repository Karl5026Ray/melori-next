import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import {
  applyStagePermissions,
  serverMuteMicrophone,
  removeLiveKitParticipant,
  livekitConfigured,
  type SocialRole,
} from "@/lib/livekitServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Moderators are the host plus any participant the host has badged as a
// co-host / mod. They may run the same stage moderation as the host.
function isModeratorRow(row: { role?: string | null; badge?: string | null } | null): boolean {
  if (!row) return false;
  return row.role === "host" || row.badge === "mod" || row.badge === "cohost";
}

// PATCH /api/social/spaces/[spaceId]/participants/[userId]
//
// Server-authoritative stage moderation for ALL room types. The caller must be
// the host OR a moderator of the space (verified from the DB, never from client
// claims). Beyond persisting the social role in Supabase, this ALSO flips the
// target's LiveKit publish permission at runtime via the server SDK, so a
// promoted user can publish and a demoted/removed user cannot — no token
// refresh, no client self-promotion.
//
// Body (any subset):
//   { role: "speaker" | "audience" }  — promote (approve/invite) or demote
//   { host_muted: boolean }           — force-mute / unmute a speaker
//   { badge: "mod" | null }           — grant / revoke moderator
//   { remove: true }                  — kick from the space (this session)
//   { ban: true }                     — HOST-ONLY: eject now AND record a
//                                       room-scoped ban so they can't rejoin
//                                       (the token route refuses banned users)
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ spaceId: string; userId: string }> },
) {
  const params = await props.params;
  const { userId: callerId } = await getRequestMembership(req);
  if (!callerId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const { data: space } = await supabase
    .from("spaces")
    .select("id, host_id, livekit_room, room_format")
    .eq("id", params.spaceId)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Authorize: host, or a badged moderator of this space.
  const isHost = space.host_id === callerId;
  let callerIsMod = isHost;
  if (!callerIsMod) {
    const { data: callerRow } = await supabase
      .from("space_participants")
      .select("role, badge")
      .eq("space_id", params.spaceId)
      .eq("user_id", callerId)
      .is("left_at", null)
      .maybeSingle();
    callerIsMod = isModeratorRow(callerRow);
  }
  if (!callerIsMod) {
    return NextResponse.json({ error: "Host or moderator only" }, { status: 403 });
  }
  if (params.userId === callerId) {
    return NextResponse.json({ error: "Cannot moderate yourself" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (typeof body.host_muted === "boolean") {
    updates.host_muted = body.host_muted;
    if (body.host_muted) updates.is_muted = true;
  }
  if (body.role === "audience" || body.role === "speaker") {
    updates.role = body.role;
    if (body.role === "audience") updates.has_raised_hand = false;
  }
  // Grant / revoke moderator. Only the host may change who is a moderator.
  if (body.badge === "mod" || body.badge === null) {
    if (!isHost) {
      return NextResponse.json(
        { error: "Only the host can assign moderators" },
        { status: 403 },
      );
    }
    updates.badge = body.badge;
  }
  if (body.remove === true) {
    updates.left_at = new Date().toISOString();
  }

  // Room ban — host only, and never the host themselves. Records a persistent
  // room-scoped ban (idempotent) and marks the participant left; the LiveKit
  // removal happens below. Banning an already-banned user is a no-op.
  if (body.ban === true) {
    if (!isHost) {
      return NextResponse.json(
        { error: "Only the host can ban" },
        { status: 403 },
      );
    }
    if (params.userId === space.host_id) {
      return NextResponse.json(
        { error: "Cannot ban the host" },
        { status: 400 },
      );
    }
    const { error: banErr } = await supabase
      .from("space_bans")
      .upsert(
        { space_id: params.spaceId, user_id: params.userId, banned_by: callerId },
        { onConflict: "space_id,user_id", ignoreDuplicates: true },
      );
    if (banErr) {
      return NextResponse.json({ error: banErr.message }, { status: 500 });
    }
    updates.left_at = new Date().toISOString();
    updates.role = "audience";
    updates.has_raised_hand = false;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  const { error } = await supabase
    .from("space_participants")
    .update(updates)
    .eq("space_id", params.spaceId)
    .eq("user_id", params.userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mirror the change onto LiveKit so publish permission actually flips at
  // runtime. Faces (live_* room_format) allow video on stage; Spaces are audio.
  if (livekitConfigured()) {
    const roomName: string = space.livekit_room ?? `space_${space.id}`;
    const withVideo = String(space.room_format ?? "").startsWith("live_");

    const { data: avatarRow } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", params.userId)
      .maybeSingle();
    const avatarUrl = (avatarRow as { avatar_url?: string | null } | null)?.avatar_url ?? null;

    if (body.ban === true) {
      // Eject the participant from the room right now. removeParticipant
      // disconnects them with reason PARTICIPANT_REMOVED and they won't
      // auto-reconnect; the token route's ban guard keeps them out on any
      // manual rejoin attempt.
      await removeLiveKitParticipant(roomName, params.userId);
    } else if (body.remove === true) {
      await applyStagePermissions({
        roomName,
        identity: params.userId,
        onStage: false,
        withVideo,
        socialRole: "audience",
        avatarUrl,
      });
      await serverMuteMicrophone(roomName, params.userId, true);
    } else if (body.role === "speaker") {
      await applyStagePermissions({
        roomName,
        identity: params.userId,
        onStage: true,
        withVideo,
        socialRole: "speaker",
        avatarUrl,
      });
    } else if (body.role === "audience") {
      await applyStagePermissions({
        roomName,
        identity: params.userId,
        onStage: false,
        withVideo,
        socialRole: "audience",
        avatarUrl,
      });
      await serverMuteMicrophone(roomName, params.userId, true);
    } else if (typeof body.host_muted === "boolean") {
      await serverMuteMicrophone(roomName, params.userId, body.host_muted);
    } else if (body.badge === "mod") {
      // Moderators stay on stage as speakers — make sure they can publish.
      await applyStagePermissions({
        roomName,
        identity: params.userId,
        onStage: true,
        withVideo,
        socialRole: "moderator" as SocialRole,
        avatarUrl,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
