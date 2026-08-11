import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import {
  filterVisibleMembers,
  safeMemberSearchTerm,
} from "@/lib/memberVisibility";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const CANDIDATE_LIMIT = 40;
type Props = { params: Promise<{ spaceId: string }> };

// GET /api/concert/battles/:spaceId/candidates?source=online|search&q=
// The browser may choose a source/query but never decides eligibility. Both
// source paths apply account, self, bidirectional block, accepted-slot, and
// room-ban filtering on the server.
export async function GET(req: NextRequest, { params }: Props) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const viewerId = guard.membership.userId;
  if (!isUuid(viewerId)) {
    return NextResponse.json({ error: "Authenticated member id must be a UUID." }, { status: 400 });
  }
  const { spaceId } = await params;
  if (!isUuid(spaceId)) {
    return NextResponse.json({ error: "spaceId must be a UUID." }, { status: 400 });
  }
  const url = new URL(req.url);
  const source = url.searchParams.get("source") === "search" ? "search" : "online";
  const queryText = safeMemberSearchTerm(url.searchParams.get("q") ?? "");

  try {
    const supabase = getSupabaseAdmin();
    const { error: expireError } = await supabase.rpc(
      "expire_concert_battle_invite_for_space",
      { p_space_id: spaceId },
    );
    if (expireError) throw expireError;
    const [{ data: space, error: spaceError }, { data: battle, error: battleError }] =
      await Promise.all([
        supabase
          .from("spaces")
          .select("id, room_format, status")
          .eq("id", spaceId)
          .maybeSingle(),
        supabase
          .from("concert_battles")
          .select("initiator_id, opponent_id, status")
          .eq("space_id", spaceId)
          .maybeSingle(),
      ]);
    if (spaceError || battleError) throw spaceError ?? battleError;
    if (!space || space.room_format !== "versus_battle" || !battle) {
      return NextResponse.json({ error: "Concert battle not found." }, { status: 404 });
    }
    if (battle.initiator_id !== viewerId) {
      return NextResponse.json({ error: "Only the Concert initiator can choose an opponent." }, { status: 403 });
    }
    if (
      space.status !== "live" ||
      battle.opponent_id ||
      !["selecting_opponent", "invited"].includes(battle.status)
    ) {
      return NextResponse.json(
        { candidates: [], error: "Opponent selection is no longer available." },
        { status: 409 },
      );
    }
    if (source === "search" && queryText.length < 2) {
      return NextResponse.json({ candidates: [], source });
    }

    const [{ data: blocks, error: blockError }, { data: bans, error: banError }] =
      await Promise.all([
        supabase
          .from("member_blocks")
          .select("blocker_id, blocked_id")
          .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
        supabase.from("space_bans").select("user_id").eq("space_id", spaceId),
      ]);
    if (blockError || banError) throw blockError ?? banError;

    let profileQuery = supabase
      .from("profiles")
      .select("id, display_name, username, avatar_url, role, verified, status, deleted_at")
      .or("status.is.null,status.eq.active")
      .is("deleted_at", null)
      .order("verified", { ascending: false })
      .order("followers_count", { ascending: false })
      .limit(CANDIDATE_LIMIT + (blocks?.length ?? 0) + (bans?.length ?? 0) + 1);
    if (source === "online") {
      profileQuery = profileQuery
        .gte("last_seen_at", new Date(Date.now() - ONLINE_WINDOW_MS).toISOString())
        .order("last_seen_at", { ascending: false });
    } else {
      profileQuery = profileQuery.or(
        `display_name.ilike.%${queryText}%,username.ilike.%${queryText}%`,
      );
    }
    const { data: profiles, error: profileError } = await profileQuery;
    if (profileError) throw profileError;

    const banned = new Set((bans ?? []).map((ban) => ban.user_id as string));
    const candidates = filterVisibleMembers(profiles ?? [], viewerId, blocks ?? [], banned)
      .filter((candidate) => candidate.id !== battle.opponent_id)
      .slice(0, CANDIDATE_LIMIT)
      .map(({ status: _status, deleted_at: _deletedAt, ...candidate }) => ({
        ...candidate,
        // This means a recent Mirror heartbeat, not an assertion of an exact
        // login time; Search results intentionally carry no presence claim.
        is_mirror_active: source === "online",
      }));

    return NextResponse.json(
      { candidates, source },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("concert candidate lookup failed", error);
    return NextResponse.json({ error: "Could not load eligible members." }, { status: 500 });
  }
}
