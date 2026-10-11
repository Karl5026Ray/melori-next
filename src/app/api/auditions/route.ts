import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { requireGoLiveReady } from "@/lib/goLiveGate.server";
import {
  AUDITION_ROOM_FORMATS,
  generateInviteCode,
  isAuditionFormat,
  resolveIsPrivate,
} from "@/lib/auditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_COLUMNS = "id, title, topic, host_id, status, room_format, is_private, created_at";

// GET /api/auditions — the caller's rooms (hosting / invited / waiting / in)
// plus OPEN rooms anyone signed in may walk up to. Private rooms never appear
// in `open`, even to people who could enter them.
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const [hosted, mine, open] = await Promise.all([
    supabase
      .from("spaces")
      .select(LIST_COLUMNS)
      .eq("host_id", me)
      .in("room_format", AUDITION_ROOM_FORMATS as unknown as string[])
      .neq("status", "ended")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("space_access")
      .select(`status, spaces!inner(${LIST_COLUMNS})`)
      .eq("user_id", me)
      .neq("status", "denied")
      .neq("spaces.status", "ended")
      .limit(20),
    supabase
      .from("spaces")
      .select(LIST_COLUMNS)
      .in("room_format", AUDITION_ROOM_FORMATS as unknown as string[])
      .eq("is_private", false)
      .eq("status", "live")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (hosted.error || mine.error || open.error) {
    console.error("[auditions] list failed", hosted.error ?? mine.error ?? open.error);
    return NextResponse.json({ error: "Could not load auditions" }, { status: 500 });
  }

  return NextResponse.json({
    hosting: hosted.data ?? [],
    mine: (mine.data ?? []).map((row: any) => ({ ...row.spaces, my_status: row.status })),
    open: (open.data ?? []).filter((r) => r.host_id !== me),
  });
}

// POST /api/auditions — a director opens a room.
// Body: { title, topic?, room_format: table_read|audition|callback, is_private }
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  // Running a room puts you on camera: same one-time phone step as going live.
  const notReady = await requireGoLiveReady(me);
  if (notReady) return notReady;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  const topic = String(body.topic ?? "").trim();
  const format = body.room_format;
  if (!title || title.length > 200) {
    return NextResponse.json({ error: "Give the room a title (200 characters max)" }, { status: 400 });
  }
  if (topic.length > 500) {
    return NextResponse.json({ error: "Notes must be 500 characters or fewer" }, { status: 400 });
  }
  if (!isAuditionFormat(format as string)) {
    return NextResponse.json({ error: "Pick Table Read, Audition or Callback" }, { status: 400 });
  }
  const roomFormat = format as (typeof AUDITION_ROOM_FORMATS)[number];
  const isPrivate = resolveIsPrivate(roomFormat, body.is_private !== false);

  const supabase = getSupabaseAdmin();

  // One active room per host, same rule as Spaces.
  await supabase
    .from("spaces")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("host_id", me)
    .neq("status", "ended")
    .then(({ error }) => error && console.warn("[auditions] prior-room cleanup failed", error.message));

  const { data: room, error } = await supabase
    .from("spaces")
    .insert({
      title,
      topic: topic || "Auditions",
      // spaces.type has its own older CHECK; "discussion" is the honest fit.
      type: "discussion",
      room_format: roomFormat,
      is_private: isPrivate,
      host_id: me,
      status: "live",
      agora_channel: `melori_${Date.now()}_${randomBytes(3).toString("hex")}`,
    })
    .select("id, room_format, is_private")
    .single();
  if (error || !room) {
    console.error("[auditions] create failed", error);
    return NextResponse.json({ error: "Could not create the room" }, { status: 500 });
  }

  // Every room gets a code; open rooms can use it too (faster than searching).
  let code: string | null = null;
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const candidate = generateInviteCode((n) => randomBytes(n));
    const { error: codeErr } = await supabase
      .from("space_invite_codes")
      .insert({ space_id: room.id, code: candidate });
    if (!codeErr) code = candidate;
    else if (codeErr.code !== "23505") {
      console.error("[auditions] code insert failed", codeErr);
      break;
    }
  }
  if (!code) {
    // A private room nobody can be invited to is useless: undo it.
    await supabase.from("spaces").delete().eq("id", room.id);
    return NextResponse.json({ error: "Could not create an invite code" }, { status: 500 });
  }

  await supabase.from("audition_room_state").insert({ space_id: room.id });

  return NextResponse.json({ room: { ...room, invite_code: code } });
}
