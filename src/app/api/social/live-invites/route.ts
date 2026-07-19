import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/live-invites?direction=incoming|outgoing|all
// Lists the caller's live-room invites. For incoming we only surface pending
// invites whose room is still live, so ended/stale invites don't clutter.
export async function GET(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { userId } = guard.membership;

  const direction =
    new URL(req.url).searchParams.get("direction") ?? "incoming";
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("live_invites")
    .select(
      `id, sender_id, recipient_id, space_id, status,
       created_at, expires_at, responded_at,
       sender:profiles!live_invites_sender_id_fkey(id, display_name, avatar_url, role, verified),
       recipient:profiles!live_invites_recipient_id_fkey(id, display_name, avatar_url, role, verified),
       space:spaces!live_invites_space_id_fkey(id, title, status, room_format, host_id)`,
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (direction === "incoming") {
    query = query.eq("recipient_id", userId).eq("status", "pending");
  } else if (direction === "outgoing") {
    query = query.eq("sender_id", userId);
  } else {
    query = query.or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let invites = data ?? [];
  // For incoming, drop invites whose room is no longer live. The nested
  // relation filter is awkward with the `or`/eq mix above, so we filter here.
  if (direction === "incoming") {
    invites = invites.filter((inv) => {
      const space = inv.space as { status?: string } | null;
      return space?.status === "live";
    });
  }

  return NextResponse.json({ invites });
}

// POST /api/social/live-invites
// Invite someone to join your live room. Body: { recipient_id, space_id }
// - Superfan+ required (sender).
// - Only the HOST of the room may invite.
// - Unique index prevents duplicate pending invites for the same room+pair.
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { userId: senderId } = guard.membership;

  // Invites are cross-user, so a runaway host is a spam vector.
  const rl = rateLimit(`social:live-invites:${senderId}`, 5, 0.2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're inviting people too quickly. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  const body = await req.json().catch(() => ({}));
  const recipientId = String(body.recipient_id ?? "").trim();
  const spaceId = String(body.space_id ?? "").trim();

  if (!recipientId || !spaceId) {
    return NextResponse.json(
      { error: "recipient_id and space_id required" },
      { status: 400 },
    );
  }
  if (recipientId === senderId) {
    return NextResponse.json(
      { error: "Cannot invite yourself" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // Confirm the room exists, is live, and the sender is its host.
  const { data: space } = await supabase
    .from("spaces")
    .select("id, status, host_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Live room not found" }, { status: 404 });
  }
  if (space.status !== "live") {
    return NextResponse.json(
      { error: "This live room is no longer active." },
      { status: 403 },
    );
  }
  if (space.host_id !== senderId) {
    return NextResponse.json(
      { error: "Only the host can invite people to this live." },
      { status: 403 },
    );
  }

  // Confirm recipient exists.
  const { data: recipient } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", recipientId)
    .maybeSingle();
  if (!recipient) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  // Refuse if either party has blocked the other. We use `limit(1)` rather
  // than `maybeSingle()` because a mutual block yields two rows and
  // `maybeSingle()` would error on that — we only need existence.
  const { data: blocks } = await supabase
    .from("member_blocks")
    .select("blocker_id")
    .or(
      `and(blocker_id.eq.${senderId},blocked_id.eq.${recipientId}),` +
        `and(blocker_id.eq.${recipientId},blocked_id.eq.${senderId})`,
    )
    .limit(1);
  if (blocks && blocks.length > 0) {
    return NextResponse.json(
      { error: "Invites are unavailable between these members." },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from("live_invites")
    .insert({
      sender_id: senderId,
      recipient_id: recipientId,
      space_id: spaceId,
    })
    .select()
    .single();

  if (error) {
    // Unique-violation → host already has a pending invite to this recipient
    // for this room.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You already invited this person to your live." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ invite: data });
}
