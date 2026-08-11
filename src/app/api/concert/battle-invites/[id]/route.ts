import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { concertBattleErrorResponse } from "@/lib/concertBattleApi";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };
type InviteResponseOutcome = "accepted" | "declined" | "expired";
type InviteResponse = { space_id: string; outcome: InviteResponseOutcome };

function isInviteResponse(value: unknown): value is InviteResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<InviteResponse>;
  return isUuid(result.space_id) &&
    (result.outcome === "accepted" || result.outcome === "declined" || result.outcome === "expired");
}

// PATCH /api/concert/battle-invites/:id
// Body: { action: "accept" | "decline" }. The recipient is token-derived and
// the SQL RPC finds/locks the invite's own battle; a browser cannot choose a
// target opponent or space by changing request JSON.
export async function PATCH(req: NextRequest, { params }: Props) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const recipientId = guard.membership.userId;
  if (!isUuid(recipientId)) {
    return NextResponse.json({ error: "Authenticated member id must be a UUID." }, { status: 400 });
  }
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invitation id must be a UUID." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const action = body.action;
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "action must be 'accept' or 'decline'." }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "respond_concert_battle_invite",
      {
        p_invite_id: id,
        p_recipient_id: recipientId,
        p_action: action,
      },
    );
    if (error) {
      const mapped = concertBattleErrorResponse(error?.message);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    if (!isInviteResponse(data)) {
      return NextResponse.json({ error: "Could not update this invitation." }, { status: 500 });
    }
    if (data.outcome === "expired") {
      const mapped = concertBattleErrorResponse("concert_battle_invite_expired");
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    return NextResponse.json({
      space_id: data.space_id,
      action,
      outcome: data.outcome,
      href: action === "accept" ? `/social/concert/${data.space_id}` : null,
    });
  } catch (error) {
    console.error("concert invitation response failed", error);
    return NextResponse.json({ error: "Could not update this invitation." }, { status: 500 });
  }
}
