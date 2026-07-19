import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { isArtistSubscriber } from "@/lib/membership";
import {
  liveParticipantCounts,
  withLiveParticipantCounts,
} from "@/lib/spacePresence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MM Faces — LIVE VIDEO rooms.
//
// A live video room is modeled as a row in the existing `spaces` table so it
// reuses the whole real-time stack (LiveKit token endpoint, participants,
// heartbeat, end). Video rooms are distinguished by room_format:
//   - "live_solo"  : one host broadcasting (TikTok-style Live)
//   - "live_duo"   : host + one guest (Duo Live)
//   - "live_group" : host + up to 8 guests (9 faces total on camera)
//
// Tier limits (from the MM Faces spec) are applied here and stored on the row
// so the client and any later moderation can enforce them:
//   FREE   : 9 people,  30 min
//   ARTIST : 50 people, unlimited
//
// GET  /api/social/faces          — list active live video rooms
// POST /api/social/faces          — create (go live) a room; caller becomes host

const VIDEO_FORMATS = new Set(["live_solo", "live_duo", "live_group"]);

function limitsForFormat(format: string, isArtist: boolean) {
  // Per-format ceilings, then clamped by the member tier.
  const formatMax =
    format === "live_solo" ? 1 : format === "live_duo" ? 2 : 9;
  const tierPeopleCap = isArtist ? 50 : 9;
  // Solo/Duo have a fixed on-camera ceiling; group is capped by tier (9 faces
  // total for free = host + 8 guests; artists could seat more in future).
  const maxOnCamera =
    format === "live_group" ? Math.min(9, tierPeopleCap) : formatMax;
  const durationMinutes = isArtist ? null : 30;
  return { maxOnCamera, durationMinutes };
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("spaces")
      .select(
        `id, title, topic, room_format, status, host_id, participant_count,
         max_capacity, duration_minutes, created_at,
         host:profiles(id, display_name, avatar_url, role, verified)`,
      )
      .in("room_format", ["live_solo", "live_duo", "live_group"])
      .eq("status", "live")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rooms = data ?? [];
    // spaces.participant_count is never written, so derive the live headcount
    // (host + everyone who has joined) from the active roster instead.
    const counts = await liveParticipantCounts(
      supabase,
      rooms.map((r) => r.id),
    );
    return NextResponse.json({ rooms: withLiveParticipantCounts(rooms, counts) });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to list live rooms" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  try {
    const body = await req.json().catch(() => ({}));
    const title = String(body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (title.length > 200) {
      return NextResponse.json(
        { error: "Title must be 200 characters or fewer" },
        { status: 400 },
      );
    }
    const topic = String(body.topic ?? "").trim();
    if (topic.length > 500) {
      return NextResponse.json(
        { error: "Topic must be 500 characters or fewer" },
        { status: 400 },
      );
    }

    // Unified TikTok-style live: default to the growable group format so a room
    // that starts with just the host can grow to the tier cap as guests join.
    // Explicit solo/duo bodies stay backward-compatible.
    const room_format = VIDEO_FORMATS.has(body.room_format)
      ? (body.room_format as string)
      : "live_group";

    const isArtist = isArtistSubscriber(membership.profile);
    const { maxOnCamera, durationMinutes } = limitsForFormat(
      room_format,
      isArtist,
    );

    const supabase = getSupabaseAdmin();

    // One active room per host (mirrors the audio spaces rule): end any prior
    // non-ended room by this user first. Best-effort.
    try {
      await supabase
        .from("spaces")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("host_id", membership.userId)
        .neq("status", "ended");
    } catch (endErr) {
      console.warn("faces one-active-room cleanup failed", endErr);
    }

    const roomKey = `melori_faces_${Date.now()}_${randomBytes(3).toString("hex")}`;

    const { data, error } = await supabase
      .from("spaces")
      .insert({
        title,
        topic: topic || "Live",
        // `type` drives the audio profile in the shared stack; video rooms use
        // a discussion-style voice profile for the host's mic.
        type: "discussion",
        room_format,
        host_id: membership.userId,
        status: "live",
        // Video capacity: on-camera faces (host + guests). Viewers who only
        // watch are not capped by this — they subscribe.
        max_participants: maxOnCamera,
        max_capacity: maxOnCamera,
        duration_minutes: durationMinutes,
        livekit_room: roomKey,
        agora_channel: roomKey,
        host_settings: {
          faces_tier: isArtist ? "artist" : "free",
          max_on_camera: maxOnCamera,
        },
      })
      .select()
      .single();

    if (error) {
      console.error("Create live room error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ room: data, tier: isArtist ? "artist" : "free" });
  } catch (err: any) {
    console.error("Create live room exception:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to create live room" },
      { status: 500 },
    );
  }
}
