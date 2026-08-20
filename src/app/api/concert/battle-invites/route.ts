import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/concert/battle-invites
// Recipient-only inbox for the one shared social-layout alert. A durable
// invitation is created before this request ever sees it, so offline members
// see an unexpired invite on a later signed-in session without push/email.
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const recipientId = guard.membership.userId!;
  if (!isUuid(recipientId)) {
    return NextResponse.json({ error: "Authenticated member id must be a UUID." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error: expireError } = await supabase.rpc(
      "expire_concert_battle_invites_for_recipient",
      { p_recipient_id: recipientId },
    );
    if (expireError) throw expireError;

    // concert_battle_invites.space_id references concert_battles(space_id),
    // not spaces(id) directly — there is no FK from this table straight to
    // `spaces` for PostgREST to walk, so `spaces!concert_battle_invites_space_id_fkey`
    // cannot be embedded here. Fetch the invite rows plain and join sender
    // profiles and spaces manually by id instead.
    const { data: inviteRows, error } = await supabase
      .from("concert_battle_invites")
      .select("id, space_id, sender_id, recipient_id, status, expires_at, created_at")
      .eq("recipient_id", recipientId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    const rows = inviteRows ?? [];
    const senderIds = Array.from(new Set(rows.map((row) => row.sender_id)));
    const spaceIds = Array.from(new Set(rows.map((row) => row.space_id)));

    const [sendersResult, spacesResult] = await Promise.all([
      senderIds.length
        ? supabase
            .from("profiles")
            .select("id, display_name, username, avatar_url, role, verified")
            .in("id", senderIds)
        : Promise.resolve({ data: [], error: null }),
      spaceIds.length
        ? supabase
            .from("spaces")
            .select("id, title, topic, status, room_format")
            .in("id", spaceIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (sendersResult.error) throw sendersResult.error;
    if (spacesResult.error) throw spacesResult.error;

    const senderById = new Map((sendersResult.data ?? []).map((sender) => [sender.id, sender]));
    const spaceById = new Map((spacesResult.data ?? []).map((space) => [space.id, space]));

    // The relationship filter is intentionally post-query: it keeps this
    // recipient-only table query straightforward while refusing stale/non-battle
    // envelope rows from the alert surface.
    const invites = rows
      .map((invite) => ({
        ...invite,
        sender: senderById.get(invite.sender_id) ?? null,
        space: spaceById.get(invite.space_id) ?? null,
      }))
      .filter((invite) => {
        const space = invite.space as { status?: string; room_format?: string } | null;
        return space?.status === "live" && space.room_format === "versus_battle";
      });

    return NextResponse.json(
      { invites, server_now: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("concert invite inbox failed", error);
    return NextResponse.json({ error: "Could not load Concert invitations." }, { status: 500 });
  }
}
