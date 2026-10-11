import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { endRoomAndTeardown } from "@/lib/endRoom";
import { isContextFailure, loadAuditionContext } from "@/lib/auditions.server";
import { deleteSessionFiles, deleteSessionRecordings } from "@/lib/auditionRecordings.server";
import { MAX_RECORDINGS_PER_SESSION } from "@/lib/auditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ spaceId: string }> };

// GET /api/auditions/[spaceId] — everything the room screen needs, already
// filtered to what THIS caller may see. Polled every few seconds by the room
// and the lobby, so it stays a handful of indexed reads.
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;
  const ctx = await loadAuditionContext((await params).spaceId, me);
  if (isContextFailure(ctx)) return ctx;

  const supabase = getSupabaseAdmin();
  const { room } = ctx;

  const filesQuery = supabase
    .from("audition_files")
    .select("id, owner_id, kind, file_name, external_url, mime_type, created_at")
    .eq("space_id", room.id)
    .order("created_at", { ascending: true });

  const [{ data: state }, { data: files }, { data: host }] = await Promise.all([
    ctx.isInside
      ? supabase
          .from("audition_room_state")
          .select("script_file_id, page, updated_at")
          .eq("space_id", room.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ctx.isDirector
      ? filesQuery
      : ctx.isInside
        ? filesQuery.or(`kind.eq.script,owner_id.eq.${me}`)
        : filesQuery.eq("owner_id", me),
    supabase
      .from("profiles")
      .select("id, display_name, username, avatar_url")
      .eq("id", room.host_id)
      .maybeSingle(),
  ]);

  let people: unknown[] = [];
  let inviteCode: string | null = null;
  let recordings: unknown[] = [];
  if (ctx.isDirector) {
    const [{ data: rows }, { data: codeRow }, { data: takes }] = await Promise.all([
      supabase
        .from("space_access")
        .select("user_id, status, character_name, updated_at")
        .eq("space_id", room.id)
        .neq("status", "denied")
        .order("updated_at", { ascending: true }),
      ctx.isHost
        ? supabase.from("space_invite_codes").select("code").eq("space_id", room.id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("audition_recordings")
        .select("id, started_at, stopped_at, downloaded_at")
        .eq("space_id", room.id)
        .order("started_at", { ascending: true }),
    ]);
    const ids = (rows ?? []).map((r) => r.user_id);
    const { data: profiles } = ids.length
      ? await supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url")
          .in("id", ids)
      : { data: [] as any[] };
    const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    people = (rows ?? []).map((r) => ({ ...r, profile: byId.get(r.user_id) ?? null }));
    inviteCode = (codeRow as { code?: string } | null)?.code ?? null;
    recordings = takes ?? [];
  } else if (ctx.isInside) {
    // Readers see who is in the read and which part they play, nothing more.
    const { data: rows } = await supabase
      .from("space_access")
      .select("user_id, character_name")
      .eq("space_id", room.id)
      .eq("status", "admitted");
    people = rows ?? [];
  }

  return NextResponse.json({
    room: {
      id: room.id,
      title: room.title,
      topic: room.topic,
      status: room.status,
      room_format: room.room_format,
      is_private: room.is_private,
      is_recording: room.is_recording,
      host,
    },
    me: {
      id: me,
      is_host: ctx.isHost,
      is_director: ctx.isDirector,
      access: ctx.access,
      character_name: ctx.characterName,
      inside: ctx.isInside,
    },
    invite_code: inviteCode,
    state: state ?? null,
    files: files ?? [],
    people,
    recordings,
    max_recordings: MAX_RECORDINGS_PER_SESSION,
  });
}

// DELETE /api/auditions/[spaceId] — the director ends the session. The room is
// torn down through the same path every other room uses, then its takes and
// uploads are deleted (Karl: nothing a session stored outlives it).
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const ctx = await loadAuditionContext((await params).spaceId, guard.membership.userId!);
  if (isContextFailure(ctx)) return ctx;
  if (!ctx.isHost) {
    return NextResponse.json({ error: "Only the director can end the session" }, { status: 403 });
  }

  const result = await endRoomAndTeardown(ctx.room.id, "host-ended");
  // After teardown the LiveKit room is gone, so any running egress is closing.
  // A take still finishing its upload is left for the cleanup cron.
  const [takes, files] = await Promise.all([
    deleteSessionRecordings(ctx.room.id),
    deleteSessionFiles(ctx.room.id),
  ]);
  return NextResponse.json({ ok: true, ended: result.ended, recordings: takes, files });
}
