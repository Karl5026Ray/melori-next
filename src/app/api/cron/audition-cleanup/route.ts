import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { deleteSessionFiles, deleteSessionRecordings } from "@/lib/auditionRecordings.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET/POST /api/cron/audition-cleanup
//
// Backstop for "nothing a session stored outlives it" (Karl, 11 Oct). The
// director's End deletes takes and uploads immediately; this catches every
// other way a room ends (host vanished and the room was reaped, idle reaper,
// admin end, a delete that failed). Any ENDED room that still has recordings
// or files gets them deleted. Takes still uploading are skipped and retried.
//
// Auth: same shared secret as the other crons —
// `x-cron-secret: $CRON_SECRET` or `Authorization: Bearer $CRON_SECRET`.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const [{ data: takeRooms }, { data: fileRooms }] = await Promise.all([
    supabase
      .from("audition_recordings")
      .select("space_id, spaces!inner(status)")
      .eq("spaces.status", "ended")
      .limit(200),
    supabase
      .from("audition_files")
      .select("space_id, spaces!inner(status)")
      .eq("spaces.status", "ended")
      .limit(200),
  ]);

  const takeIds = [...new Set((takeRooms ?? []).map((r) => r.space_id as string))];
  const fileIds = [...new Set((fileRooms ?? []).map((r) => r.space_id as string))];

  let takesDeleted = 0;
  let takesPending = 0;
  let filesDeleted = 0;
  for (const id of takeIds) {
    const r = await deleteSessionRecordings(id);
    takesDeleted += r.deleted;
    takesPending += r.pending;
  }
  for (const id of fileIds) filesDeleted += await deleteSessionFiles(id);

  return NextResponse.json({
    ok: true,
    rooms: new Set([...takeIds, ...fileIds]).size,
    takesDeleted,
    takesPending,
    filesDeleted,
  });
}

export const GET = handle;
export const POST = handle;
