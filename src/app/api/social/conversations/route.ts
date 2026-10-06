import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/conversations
// Returns the caller's conversations for the inbox list. Uses the
// service-role client and filters to conversations the caller belongs to.
//
// Previously the messages page was a Server Component that used the
// browser (anon) supabase client with no user session. After migration
// 009 turned on RLS for these tables, auth.uid() is null server-side
// so the query returned zero rows — the inbox looked empty even when
// conversations existed. This route runs the query under service_role
// with an explicit "I am userId" filter, which is safe because we
// verify the token first.
export async function GET(req: NextRequest) {
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Conversations the caller belongs to.
  const { data: myMemberships, error: memErr } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);
  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }
  const convIds = (myMemberships ?? []).map(
    (m: { conversation_id: string }) => m.conversation_id,
  );
  if (convIds.length === 0) {
    return NextResponse.json({ conversations: [] });
  }

  const { data, error } = await supabase
    .from("conversations")
    .select(
      `
      *,
      members:conversation_members(
        user_id,
        last_read_at,
        user:profiles(id, username, display_name, avatar_url, role, verified)
      )
    `,
    )
    .in("id", convIds)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Newest message + unread count per thread, computed in Postgres
  // (dm_inbox_summary, migration 086). This used to embed EVERY message of
  // every conversation and reduce them here, so the payload grew without
  // bound as history accumulated.
  const shownIds = (data ?? []).map((c: { id: string }) => c.id);
  const { data: summary, error: sumErr } = shownIds.length
    ? await supabase.rpc("dm_inbox_summary", {
        p_user: userId,
        p_conv_ids: shownIds,
      })
    : { data: [], error: null };
  if (sumErr) {
    return NextResponse.json({ error: sumErr.message }, { status: 500 });
  }
  const byConv = new Map<string, any>(
    (summary ?? []).map((r: any) => [r.conversation_id, r]),
  );

  // Response shape is unchanged: `messages` holds at most the newest message.
  const conversations = (data ?? []).map((conv: any) => {
    const s = byConv.get(conv.id);
    const latest = s?.last_message_id
      ? {
          id: s.last_message_id,
          content: s.last_content,
          created_at: s.last_created_at,
          sender_id: s.last_sender_id,
          deleted_at: null,
        }
      : null;
    return {
      ...conv,
      messages: latest ? [latest] : [],
      unread_count: s?.unread_count ?? 0,
    };
  });

  return NextResponse.json({ conversations });
}
