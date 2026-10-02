import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendSpaceReminderEmail } from "@/lib/email";
import { unsubscribeUrl } from "@/lib/notify-tokens";
import { reminderAction } from "@/lib/spaceReminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_ORIGIN = "https://melorimusic.org";
// Bounds one run after an outage. At current volume it is never reached.
const MAX_REMINDERS = 300;

type ReminderRow = { id: string; space_id: string; user_id: string };
type SpaceRow = {
  id: string;
  title: string | null;
  status: string | null;
  scheduled_at: string | null;
  ended_at: string | null;
  room_format: string | null;
  host_id: string | null;
};
type ProfileRow = {
  id: string;
  display_name: string | null;
  username: string | null;
  notifications_email: boolean | null;
  status: string | null;
  deleted_at: string | null;
};

const nameOf = (p: ProfileRow | undefined, fallback: string) =>
  p?.display_name?.trim() || p?.username?.trim() || fallback;

// GET/POST /api/cron/space-reminders  (every 5 minutes, see vercel.json)
//
// Emails everyone who tapped "remind me" on a room, once, when it goes live or
// is about to start (src/lib/spaceReminders.ts decides which). Each reminder
// row is stamped with notified_at after its email sends, so a run can never
// email anyone twice; a failed send is left unstamped for the next run.
// Ended rooms and rooms whose host never showed are stamped without an email.
//
// Auth mirrors the other crons: CRON_SECRET via x-cron-secret or Bearer.
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
  const now = Date.now();

  const { data: reminderRows, error: remErr } = await supabase
    .from("space_reminders")
    .select("id, space_id, user_id")
    .is("notified_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_REMINDERS);
  if (remErr) {
    console.error("space-reminders: reminder query failed", remErr.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
  const reminders = (reminderRows ?? []) as ReminderRow[];
  if (!reminders.length) return NextResponse.json({ ok: true, considered: 0, emailed: 0 });

  const spaceIds = [...new Set(reminders.map((r) => r.space_id))];
  const { data: spaceRows } = await supabase
    .from("spaces")
    .select("id, title, status, scheduled_at, ended_at, room_format, host_id")
    .in("id", spaceIds);
  const spaceById = new Map(((spaceRows ?? []) as SpaceRow[]).map((s) => [s.id, s]));

  const profileIds = [
    ...new Set([
      ...reminders.map((r) => r.user_id),
      ...((spaceRows ?? []) as SpaceRow[]).map((s) => s.host_id).filter(Boolean) as string[],
    ]),
  ];
  const { data: profileRows } = await supabase
    .from("profiles")
    .select("id, display_name, username, notifications_email, status, deleted_at")
    .in("id", profileIds);
  const profileById = new Map(((profileRows ?? []) as ProfileRow[]).map((p) => [p.id, p]));

  const stamp: string[] = [];
  let emailed = 0;
  let waiting = 0;
  let skipped = 0;
  let failed = 0;

  for (const reminder of reminders) {
    const space = spaceById.get(reminder.space_id);
    // Room deleted out from under the reminder: nothing to send, ever.
    if (!space) {
      stamp.push(reminder.id);
      skipped += 1;
      continue;
    }
    const action = reminderAction({
      status: space.status,
      scheduledAt: space.scheduled_at,
      endedAt: space.ended_at,
      now,
    });
    if (action === "wait") {
      waiting += 1;
      continue;
    }
    const profile = profileById.get(reminder.user_id);
    const optedOut =
      !profile ||
      profile.notifications_email === false ||
      Boolean(profile.deleted_at) ||
      (profile.status !== null && profile.status !== "active") ||
      reminder.user_id === space.host_id;
    if (action === "skip" || optedOut) {
      stamp.push(reminder.id);
      skipped += 1;
      continue;
    }

    const { data: authUser } = await supabase.auth.admin.getUserById(reminder.user_id);
    const to = authUser?.user?.email;
    if (!to) {
      stamp.push(reminder.id);
      skipped += 1;
      continue;
    }

    const path = space.room_format === "cinema" ? "cinema" : "spaces";
    try {
      await sendSpaceReminderEmail({
        to,
        greetingName: nameOf(profile, "there").split(" ")[0] ?? "there",
        roomTitle: space.title?.trim() || "A room you saved",
        hostName: nameOf(profileById.get(space.host_id ?? ""), "the host"),
        live: action === "live",
        roomUrl: `${SITE_ORIGIN}/social/${path}/${space.id}`,
        unsubscribeUrl: unsubscribeUrl(SITE_ORIGIN, reminder.user_id),
      });
      stamp.push(reminder.id);
      emailed += 1;
    } catch (e) {
      failed += 1;
      console.error("space-reminders: send failed", reminder.id, e instanceof Error ? e.message : e);
    }
    // Resend's default rate limit is 2 requests/second.
    await new Promise((r) => setTimeout(r, 600));
  }

  if (stamp.length) {
    const { error } = await supabase
      .from("space_reminders")
      .update({ notified_at: new Date().toISOString() })
      .in("id", stamp);
    if (error) console.error("space-reminders: stamp failed", error.message);
  }

  return NextResponse.json({
    ok: true,
    considered: reminders.length,
    emailed,
    waiting,
    skipped,
    retrying: failed,
  });
}

export const GET = handle;
export const POST = handle;
