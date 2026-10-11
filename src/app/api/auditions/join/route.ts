import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { requireGoLiveReady } from "@/lib/goLiveGate.server";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";
import {
  auditionRoomHref,
  decideEntry,
  isAuditionFormat,
  normalizeInviteCode,
  type AccessStatus,
  type EntryVia,
} from "@/lib/auditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auditions/join
// Body: { code } — any room, using its invite code
//    or { space_id } — an OPEN room picked from the list
//
// Writes the caller's space_access row (lobby or admitted) via the service
// role. This is the only door into a room for anyone but the director.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  // Codes are short: throttle guessing.
  const rl = rateLimit(`auditions:join:${me}`, 10, 10 / 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const supabase = getSupabaseAdmin();

  let spaceId: string | null = null;
  let via: EntryVia;
  if (body.code !== undefined) {
    const code = normalizeInviteCode(body.code);
    if (!code) return NextResponse.json({ error: "That code doesn't look right" }, { status: 400 });
    const { data } = await supabase
      .from("space_invite_codes")
      .select("space_id")
      .eq("code", code)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "No room with that code" }, { status: 404 });
    spaceId = data.space_id;
    via = "code";
  } else if (isUuid(body.space_id)) {
    spaceId = body.space_id;
    via = "open-listing";
  } else {
    return NextResponse.json({ error: "Enter an invite code" }, { status: 400 });
  }

  const { data: room } = await supabase
    .from("spaces")
    .select("id, host_id, status, room_format, is_private")
    .eq("id", spaceId)
    .maybeSingle();
  if (!room || !isAuditionFormat(room.room_format)) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.status === "ended") {
    return NextResponse.json({ error: "This session has ended" }, { status: 410 });
  }
  if (room.host_id === me) {
    return NextResponse.json({ status: "host", href: auditionRoomHref(room.id) });
  }

  const { data: ban } = await supabase
    .from("space_bans")
    .select("user_id")
    .eq("space_id", room.id)
    .eq("user_id", me)
    .maybeSingle();
  if (ban) {
    return NextResponse.json({ error: "You were removed from this room" }, { status: 403 });
  }

  const { data: existingRow } = await supabase
    .from("space_access")
    .select("status")
    .eq("space_id", room.id)
    .eq("user_id", me)
    .maybeSingle();
  const existing = (existingRow?.status as AccessStatus | undefined) ?? null;

  const decision = decideEntry({
    format: room.room_format,
    isPrivate: Boolean(room.is_private),
    via,
    existing,
  });
  if (!decision.ok) {
    // A private room you have no claim on is "not found", same as a bad id.
    if (decision.reason === "private") {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const msg =
      decision.reason === "denied"
        ? "The director has closed this room to you"
        : "This callback is by invitation only. Ask the director to add you.";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  // Admitted actors go on camera, so the go-live phone step applies to them
  // just like a guest raising a hand in Spaces.
  const notReady = await requireGoLiveReady(me);
  if (notReady) return notReady;

  if (existing !== decision.status) {
    const { error } = await supabase.from("space_access").upsert(
      {
        space_id: room.id,
        user_id: me,
        status: decision.status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "space_id,user_id" },
    );
    if (error) {
      console.error("[auditions/join] access write failed", error);
      return NextResponse.json({ error: "Could not join the room" }, { status: 500 });
    }
  }

  return NextResponse.json({ status: decision.status, href: auditionRoomHref(room.id) });
}
