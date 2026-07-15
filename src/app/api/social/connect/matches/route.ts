import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/connect/matches — my active matches with the other member's
// display info and a last-message preview.
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const { data: matches } = await supabase
    .from("dating_matches")
    .select("id, user_a, user_b, status, created_at")
    .or(`user_a.eq.${me},user_b.eq.${me}`)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const rows = matches ?? [];
  if (rows.length === 0) return NextResponse.json({ matches: [] });

  const otherIds = rows.map((m) =>
    (m as { user_a: string; user_b: string }).user_a === me
      ? (m as { user_b: string }).user_b
      : (m as { user_a: string }).user_a,
  );
  const matchIds = rows.map((m) => (m as { id: string }).id);

  const [profilesRes, photosRes, messagesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name, full_name, avatar_url")
      .in("id", otherIds),
    supabase
      .from("dating_profile_photos")
      .select("profile_id, image_url, sort_order")
      .in("profile_id", otherIds)
      .order("sort_order", { ascending: true }),
    supabase
      .from("dating_messages")
      .select("match_id, body, sender_id, created_at, read_at")
      .in("match_id", matchIds)
      .order("created_at", { ascending: false }),
  ]);

  const profileMap = new Map<string, any>();
  for (const p of profilesRes.data ?? []) profileMap.set((p as { id: string }).id, p);
  const photoMap = new Map<string, string>();
  for (const ph of photosRes.data ?? []) {
    const r = ph as { profile_id: string; image_url: string };
    if (!photoMap.has(r.profile_id)) photoMap.set(r.profile_id, r.image_url);
  }
  const lastMsgMap = new Map<string, any>();
  for (const msg of messagesRes.data ?? []) {
    const r = msg as { match_id: string };
    if (!lastMsgMap.has(r.match_id)) lastMsgMap.set(r.match_id, msg);
  }

  const result = rows.map((m) => {
    const mm = m as { id: string; user_a: string; user_b: string; created_at: string };
    const otherId = mm.user_a === me ? mm.user_b : mm.user_a;
    const prof = profileMap.get(otherId);
    const last = lastMsgMap.get(mm.id) as
      | { body: string; sender_id: string; created_at: string; read_at: string | null }
      | undefined;
    return {
      match_id: mm.id,
      created_at: mm.created_at,
      other: {
        id: otherId,
        username: prof?.username ?? null,
        display_name: prof?.display_name ?? prof?.full_name ?? prof?.username ?? "Member",
        avatar_url: prof?.avatar_url ?? null,
        photo_url: photoMap.get(otherId) ?? prof?.avatar_url ?? null,
      },
      last_message: last
        ? {
            body: last.body,
            from_me: last.sender_id === me,
            created_at: last.created_at,
            unread: !last.read_at && last.sender_id !== me,
          }
        : null,
    };
  });

  return NextResponse.json({ matches: result });
}
