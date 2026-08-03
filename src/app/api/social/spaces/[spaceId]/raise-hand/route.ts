import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { handRaiseAllowed } from "@/lib/spacesStage";
import type { HandRaiseMode } from "@/types/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/[spaceId]/raise-hand
// Body: { raised: boolean }
//
// Toggle the CALLER's raised-hand flag on their active participant row. Every
// other room mutation (comments, reactions, role changes, leave) already goes
// through a server route on the admin client; the raise-hand action was the one
// outlier doing a direct client-side UPDATE, which RLS blocked, so the host
// never saw the request. Routing it through the server (service role) makes it
// reliable and keeps WHO is raising server-authoritative (always the caller,
// never a client-supplied id). The DB trigger from migration 028 keeps
// stage_requested_at in sync so the host's queue orders oldest-first.
//
// Clubhouse parity: raising a hand requires ONLY a signed-in account (see
// requireAuth below and src/lib/spacesStage.ts) -- no Superfan gate. Speaking
// still requires the host to promote the caller afterwards; that is enforced
// separately by the livekit-token route and the participants PATCH route.
//
// The host may restrict who can raise a hand at all via
// spaces.hand_raise_mode ('off' | 'followed' | 'everyone', migration 047).
// Lowering an already-raised hand (raised=false) is always allowed regardless
// of mode -- the mode only gates NEW hand-raise requests.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ spaceId: string }> },
) {
  const params = await props.params;
  const spaceId = String(params.spaceId ?? "").trim();
  if (!spaceId || !isUuid(spaceId)) {
    return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
  }

  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId!;

  const body = await req.json().catch(() => ({}));
  const raised = body?.raised === true;

  const supabase = getSupabaseAdmin();

  if (raised) {
    const { data: space } = await supabase
      .from("spaces")
      .select("hand_raise_mode")
      .eq("id", spaceId)
      .maybeSingle();
    const mode = (space?.hand_raise_mode ?? "everyone") as HandRaiseMode;
    if (!handRaiseAllowed(mode, { signedIn: true })) {
      return NextResponse.json(
        { error: "The host has turned off hand-raising for this space" },
        { status: 403 },
      );
    }
  }

  // Update the caller's active row. Upsert as a fallback so a hand can be raised
  // even if the presence row hasn't been written yet (defensive; the client
  // normally creates it on join).
  const { data: updated, error } = await supabase
    .from("space_participants")
    .update({ has_raised_hand: raised })
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .is("left_at", null)
    .select("user_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!updated) {
    const { error: upsertErr } = await supabase.from("space_participants").upsert(
      {
        space_id: spaceId,
        user_id: userId,
        role: "audience",
        has_raised_hand: raised,
        left_at: null,
      },
      { onConflict: "space_id,user_id" },
    );
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, raised });
}
