import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upper bound on rows pulled to compute the badge. A member with more than this
// many genuinely unread messages sees "99+" either way, so the cap only bounds
// the query cost.
const MAX_ROWS = 500;

// GET /api/social/conversations/unread
// Returns { unread_total, unread_threads } for the Messages nav badge.
//
// Deliberately separate from GET /api/social/conversations: the badge renders on
// every page, so it must not pull the whole inbox (members, profiles, message
// bodies) just to show a number.
export async function GET(req: NextRequest) {
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ unread_total: 0, unread_threads: 0 });
  }

  const supabase = getSupabaseAdmin();

  const { data: memberships, error: memErr } = await supabase
    .from("conversation_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId);
  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }
  if (!memberships?.length) {
    return NextResponse.json({ unread_total: 0, unread_threads: 0 });
  }

  const lastReadByConv = new Map<string, number>();
  for (const m of memberships) {
    lastReadByConv.set(
      m.conversation_id,
      m.last_read_at ? new Date(m.last_read_at).getTime() : 0,
    );
  }

  // Only messages newer than the earliest read cursor can possibly be unread,
  // which keeps this off a full scan of the member's message history.
  const floor = Math.min(...lastReadByConv.values());

  const { data: rows, error } = await supabase
    .from("messages")
    .select("conversation_id, created_at")
    .in("conversation_id", [...lastReadByConv.keys()])
    .neq("sender_id", userId)
    .is("deleted_at", null)
    .gt("created_at", new Date(floor).toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let total = 0;
  const threads = new Set<string>();
  for (const r of rows ?? []) {
    const lastRead = lastReadByConv.get(r.conversation_id) ?? 0;
    if (new Date(r.created_at).getTime() > lastRead) {
      total += 1;
      threads.add(r.conversation_id);
    }
  }

  return NextResponse.json({
    unread_total: total,
    unread_threads: threads.size,
  });
}
