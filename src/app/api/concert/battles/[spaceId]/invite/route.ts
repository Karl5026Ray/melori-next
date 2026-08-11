import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import { concertBattleErrorResponse } from "@/lib/concertBattleApi";
import { filterVisibleMembers } from "@/lib/memberVisibility";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ spaceId: string }> };

// POST /api/concert/battles/:spaceId/invite
// Body intentionally contains only the selected recipient id. Initiator,
// opponent, and battle identity are derived/validated server-side.
export async function POST(req: NextRequest, { params }: Props) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const initiatorId = guard.membership.userId;
  if (!isUuid(initiatorId)) {
    return NextResponse.json({ error: "Authenticated member id must be a UUID." }, { status: 400 });
  }
  const { spaceId } = await params;
  if (!isUuid(spaceId)) {
    return NextResponse.json({ error: "spaceId must be a UUID." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const recipientId = String(body.recipient_id ?? "").trim();
  if (!recipientId) {
    return NextResponse.json({ error: "recipient_id is required." }, { status: 400 });
  }
  if (!isUuid(recipientId)) {
    return NextResponse.json({ error: "recipient_id must be a UUID." }, { status: 400 });
  }

  const throttle = rateLimit(`concert:battle-invites:${initiatorId}`, 5, 0.2);
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: "You're sending invitations too quickly. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(throttle.retryAfterMs / 1000).toString() },
      },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    // Recheck all candidate rules at mutation time. Candidate rendering is never
    // authorization, and this protects a stale search result/racing ban.
    const [
      { data: battle, error: battleError },
      { data: recipient, error: recipientError },
      { data: blocks, error: blockError },
      { data: bans, error: banError },
    ] = await Promise.all([
      supabase
        .from("concert_battles")
        .select("initiator_id, opponent_id, status")
        .eq("space_id", spaceId)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("id, status, deleted_at")
        .eq("id", recipientId)
        .maybeSingle(),
      supabase
        .from("member_blocks")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${initiatorId},blocked_id.eq.${initiatorId}`),
      supabase.from("space_bans").select("user_id").eq("space_id", spaceId),
    ]);
    if (battleError || recipientError || blockError || banError) {
      throw battleError ?? recipientError ?? blockError ?? banError;
    }
    if (!battle) {
      return NextResponse.json({ error: "Concert battle not found." }, { status: 404 });
    }
    if (battle.initiator_id !== initiatorId) {
      return NextResponse.json({ error: "Only the Concert initiator can invite an opponent." }, { status: 403 });
    }
    const banned = new Set((bans ?? []).map((ban) => ban.user_id as string));
    if (
      !filterVisibleMembers(recipient ? [recipient] : [], initiatorId, blocks ?? [], banned)
        .some((member) => member.id === recipientId) ||
      recipientId === battle.opponent_id
    ) {
      return NextResponse.json(
        { error: "This member is not eligible for this Concert invitation." },
        { status: 409 },
      );
    }

    const { data: inviteId, error } = await supabase.rpc("invite_concert_opponent", {
      p_space_id: spaceId,
      p_initiator_id: initiatorId,
      p_recipient_id: recipientId,
    });
    if (error || !inviteId) {
      const mapped = concertBattleErrorResponse(error?.message);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    return NextResponse.json({ invite_id: inviteId, space_id: spaceId }, { status: 201 });
  } catch (error) {
    console.error("concert invite failed", error);
    return NextResponse.json({ error: "Could not send this invitation." }, { status: 500 });
  }
}

// DELETE /api/concert/battles/:spaceId/invite
// Explicit cancellation is required before an initiator may replace a pending
// invite. This does not and cannot alter an accepted slot 2.
export async function DELETE(req: NextRequest, { params }: Props) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const initiatorId = guard.membership.userId;
  if (!isUuid(initiatorId)) {
    return NextResponse.json({ error: "Authenticated member id must be a UUID." }, { status: 400 });
  }
  const { spaceId } = await params;
  if (!isUuid(spaceId)) {
    return NextResponse.json({ error: "spaceId must be a UUID." }, { status: 400 });
  }

  try {
    const { data: inviteId, error } = await getSupabaseAdmin().rpc(
      "cancel_concert_battle_invite",
      { p_space_id: spaceId, p_initiator_id: initiatorId },
    );
    if (error) {
      const mapped = concertBattleErrorResponse(error.message);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    return NextResponse.json({ invite_id: inviteId, space_id: spaceId });
  } catch (error) {
    console.error("concert invite cancellation failed", error);
    return NextResponse.json({ error: "Could not cancel this invitation." }, { status: 500 });
  }
}
