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
      ),
      messages:messages(
        id, content, created_at, sender_id, deleted_at
      )
    `,
    )
    .in("id", convIds)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Reduce each conversation to what the inbox actually renders: the newest
  // message plus the caller's unread count. Previously every message of every
  // conversation was serialised to the client (the list only ever used the
  // newest one), which made the inbox payload grow without bound.
  const conversations = (data ?? []).map((conv: any) => {
    const messages: any[] = conv.messages ?? [];
    const mine = (conv.members ?? []).find((m: any) => m.user_id === userId);
    const lastReadAt = mine?.last_read_at
      ? new Date(mine.last_read_at).getTime()
      : 0;

    let latest: any = null;
    let unread = 0;
    for (const m of messages) {
      if (m.deleted_at) continue;
      const at = new Date(m.created_at).getTime();
      if (!latest || at > new Date(latest.created_at).getTime()) latest = m;
      if (m.sender_id !== userId && at > lastReadAt) unread += 1;
    }

    return {
      ...conv,
      messages: latest ? [latest] : [],
      unread_count: unread,
    };
  });

  return NextResponse.json({ conversations });
}
