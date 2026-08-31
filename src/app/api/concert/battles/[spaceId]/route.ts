import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getConcertBattleSlot } from "@/lib/concertBattle";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ spaceId: string }> };

// GET /api/concert/battles/:spaceId
// A dedicated, authenticated battle read. It returns display state only; invite
// recipient information is private to the sender/recipient and no presence,
// wallet, or sender-history data is returned.
export async function GET(req: NextRequest, { params }: Props) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const viewerId = guard.membership.userId;
  if (!isUuid(viewerId)) {
    return NextResponse.json({ error: "Authenticated member id must be a UUID." }, { status: 400 });
  }
  const { spaceId } = await params;
  if (!isUuid(spaceId)) {
    return NextResponse.json({ error: "spaceId must be a UUID." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    // Make an expired outgoing invitation observable as selecting-opponent even
    // when its recipient has not opened their inbox. This RPC locks the space,
    // battle, and pending invite and is a no-op for all other states.
    const { error: expireError } = await supabase.rpc(
      "expire_concert_battle_invite_for_space",
      { p_space_id: spaceId },
    );
    if (expireError) throw expireError;
    const { data: space, error: spaceError } = await supabase
      .from("spaces")
      .select("id, title, topic, status, room_format")
      .eq("id", spaceId)
      .maybeSingle();
    if (spaceError) throw spaceError;
    if (!space || space.room_format !== "versus_battle") {
      return NextResponse.json({ error: "Concert battle not found." }, { status: 404 });
    }

    const { data: battle, error: battleError } = await supabase
      .from("concert_battles")
      .select(
        "space_id, initiator_id, opponent_id, status, current_round, regulation_rounds, round_duration_seconds, phase_started_at, phase_ends_at, winner_id, completion_reason, version, created_at, updated_at, completed_at",
      )
      .eq("space_id", spaceId)
      .maybeSingle();
    if (battleError) throw battleError;
    if (!battle) {
      return NextResponse.json({ error: "Concert battle not found." }, { status: 404 });
    }

    const profileIds = [battle.initiator_id, battle.opponent_id].filter(
      Boolean,
    ) as string[];
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, username, avatar_url, role, verified")
      .in("id", profileIds);
    if (profileError) throw profileError;
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const initiator = profileById.get(battle.initiator_id);
    if (!initiator) {
      return NextResponse.json({ error: "Concert initiator is unavailable." }, { status: 409 });
    }

    // DISPLAY-ONLY live score. concert_battle_rounds still owns round outcomes;
    // a failed aggregate degrades to zeroes rather than failing the whole read,
    // because a missing score must not black out the live stage.
    let scores = { initiator_coins: 0, opponent_coins: 0, initiator_gifts: 0, opponent_gifts: 0 };
    const { data: totals, error: totalsError } = await supabase.rpc(
      "concert_battle_gift_totals",
      { p_space_id: spaceId },
    );
    if (totalsError) {
      console.error("concert battle gift totals failed", totalsError);
    } else {
      const row = Array.isArray(totals) ? totals[0] : totals;
      if (row) {
        scores = {
          initiator_coins: Number(row.initiator_coins ?? 0),
          opponent_coins: Number(row.opponent_coins ?? 0),
          initiator_gifts: Number(row.initiator_gifts ?? 0),
          opponent_gifts: Number(row.opponent_gifts ?? 0),
        };
      }
    }

    const { data: pendingInvite, error: inviteError } = await supabase
      .from("concert_battle_invites")
      .select("id, sender_id, recipient_id, status, expires_at, created_at")
      .eq("space_id", spaceId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (inviteError) throw inviteError;

    const canSeePendingInvite =
      pendingInvite &&
      (pendingInvite.sender_id === viewerId || pendingInvite.recipient_id === viewerId);
    const inviteRecipient =
      canSeePendingInvite && pendingInvite
        ? profileById.get(pendingInvite.recipient_id) ??
          (
            await supabase
              .from("profiles")
              .select("id, display_name, username, avatar_url, role, verified")
              .eq("id", pendingInvite.recipient_id)
              .maybeSingle()
          ).data
        : null;

    return NextResponse.json(
      {
        space,
        battle,
        initiator,
        opponent: battle.opponent_id ? profileById.get(battle.opponent_id) ?? null : null,
        scores,
        viewer_slot: getConcertBattleSlot(battle, viewerId),
        viewer_capabilities: {
          can_select_opponent:
            battle.initiator_id === viewerId &&
            (battle.status === "selecting_opponent" || battle.status === "invited") &&
            !battle.opponent_id,
          can_cancel_invite:
            battle.initiator_id === viewerId &&
            battle.status === "invited" &&
            !battle.opponent_id,
        },
        pending_invite: canSeePendingInvite && pendingInvite
          ? { ...pendingInvite, recipient: inviteRecipient }
          : null,
        server_now: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("concert battle read failed", error);
    return NextResponse.json({ error: "Could not load this Concert battle." }, { status: 500 });
  }
}
