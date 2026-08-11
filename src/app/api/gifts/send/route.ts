import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { canSendGiftInRoom, isEligibleGiftTarget } from "@/lib/gifting";
import { publishGiftSignal } from "@/lib/pubnubServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId!;

  const body = await req.json().catch(() => ({}));
  const spaceId = typeof body.space_id === "string" ? body.space_id : "";
  const targetId = typeof body.target_id === "string" ? body.target_id : "";
  const giftId = typeof body.gift_id === "string" ? body.gift_id.trim() : "";
  if (!isUuid(spaceId) || !isUuid(targetId) || !isUuid(giftId)) {
    return NextResponse.json({ error: "Invalid gift request" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: room, error: roomError } = await supabase
    .from("spaces")
    .select("id, host_id, status, room_format")
    .eq("id", spaceId)
    .maybeSingle();
  if (roomError) return NextResponse.json({ error: "Could not verify room" }, { status: 500 });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.status !== "live" || room.room_format !== "versus_battle") {
    return NextResponse.json({ error: "Gifts are only available in live Concert rooms" }, { status: 409 });
  }

  const { data: roomParticipants, error: participantError } = await supabase
    .from("space_participants")
    .select("user_id, role")
    .eq("space_id", spaceId)
    .is("left_at", null)
    .in("user_id", [userId, targetId]);
  if (participantError) return NextResponse.json({ error: "Could not verify participants" }, { status: 500 });

  const sender = (roomParticipants ?? []).find((p) => p.user_id === userId);
  const target = (roomParticipants ?? []).find((p) => p.user_id === targetId);
  // A room's canonical host remains a valid default target even if a transient
  // roster refresh has not yet reinserted the host participant row. Speakers,
  // by contrast, must have an active row right now.
  const effectiveTarget =
    target ?? (targetId === room.host_id ? { user_id: targetId, role: "host" as const } : null);
  const targetAllowed =
    effectiveTarget && isEligibleGiftTarget(effectiveTarget, room.host_id);
  if (!canSendGiftInRoom({
    roomFormat: room.room_format,
    roomStatus: room.status,
    sender,
    target: targetAllowed ? effectiveTarget : null,
    hostId: room.host_id,
  })) {
    return NextResponse.json({ error: "You can only gift an active Concert host or speaker" }, { status: 403 });
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("spend_coins_on_gift", {
    p_user_id: userId,
    p_gift_id: giftId,
    p_space_id: spaceId,
    p_target_id: targetId,
  });
  if (rpcError) {
    if (
      rpcError.message.includes("gift_not_found") ||
      rpcError.message.includes("gift_inactive")
    ) {
      return NextResponse.json({ error: "Gift not found" }, { status: 404 });
    }
    if (rpcError.message.includes("insufficient_balance")) {
      return NextResponse.json({ error: "Not enough coins" }, { status: 409 });
    }
    console.error("spend gift coins failed", rpcError);
    return NextResponse.json({ error: "Could not send gift" }, { status: 500 });
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const [{ data: gift }, { data: senderProfile }] = await Promise.all([
    supabase
      .from("gifts")
      .select("id, slug, name, tier, asset_url, duration_ms, price_coins")
      .eq("id", giftId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name, full_name, username")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (!gift) {
    // This can only happen during catalog drift after the transactional RPC.
    // The spend remains recorded; return a retriable server error rather than
    // inventing a client-side asset payload.
    console.error("gift was spent but catalog item could not be re-read", giftId);
    return NextResponse.json({ error: "Could not render sent gift" }, { status: 500 });
  }

  await publishGiftSignal(spaceId, {
    uuid: userId,
    giftSendId: result?.gift_send_id,
    gift,
    target: targetId,
    senderName:
      senderProfile?.display_name ??
      senderProfile?.full_name ??
      senderProfile?.username ??
      undefined,
  });
  return NextResponse.json({
    balance: result?.new_balance ?? 0,
    gift_send_id: result?.gift_send_id,
    gift,
  });
}
