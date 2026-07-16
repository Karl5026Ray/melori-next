import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import {
  liveParticipantCounts,
  withLiveParticipantCounts,
} from "@/lib/spacePresence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How recently a member must have heartbeated (POST /api/presence/heartbeat) to
// count as "online now". The client heartbeats ~every 60s, so a 2-minute window
// tolerates one missed beat before a member drops off the row.
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

// GET /api/mirror/live
// -------------------------------------------------------------------------
// The "online now" ring row at the top of Melori Mirror. It returns two lists:
//
//   live    — `spaces` where status='live', joined to the host profile. Each
//             ring deep-links into a real, joinable room. Shown FIRST because
//             Mirror's promise is "tap a ring to join what's happening now."
//   members — profiles seen within ONLINE_WINDOW_MS via the presence heartbeat
//             (last_seen_at). These are members who are genuinely online right
//             now but not hosting a live room; their ring links to their
//             profile. This is what makes other online members show up in the
//             row (previously it only ever showed live-room hosts).
//
// Runs on the admin client so it is not gated by the per-row profiles RLS the
// anonymous client is subject to. Auth is optional: a Bearer token only lets us
// drop the caller from the online-members list so they don't see themselves.
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("spaces")
      .select(
        `id, title, topic, type, status, room_format, livekit_room,
         participant_count, last_activity_at, created_at,
         host:profiles!spaces_host_id_fkey(
           id, display_name, username, avatar_url, verified, role
         )`,
      )
      .eq("status", "live")
      .order("participant_count", { ascending: false })
      .order("last_activity_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Supabase infers the `host:profiles!fkey(...)` embed as an ARRAY at the
    // type level even though a to-one FK returns a single object at runtime.
    // Normalize it to a single object up front so every downstream read
    // (host?.id here, and the host name/avatar the client renders) sees the same
    // object shape and type-checks. Only surface rooms that actually have a host
    // joined — a live row with a missing host can't render a ring or destination.
    const hosted = (data ?? [])
      .map((r) => ({
        ...r,
        host: (Array.isArray(r.host) ? r.host[0] : r.host) ?? null,
      }))
      .filter((r) => r.host);

    // spaces.participant_count is never written, so the SQL sort above ties on a
    // frozen 0. Derive the live headcount from the active roster, override the
    // reported count, and re-sort by it (then recency) so busier rooms lead.
    const counts = await liveParticipantCounts(
      supabase,
      hosted.map((r) => r.id),
    );
    const live = withLiveParticipantCounts(hosted, counts).sort((a, b) => {
      const byCount = (b.participant_count ?? 0) - (a.participant_count ?? 0);
      if (byCount !== 0) return byCount;
      return (
        new Date(b.last_activity_at ?? 0).getTime() -
        new Date(a.last_activity_at ?? 0).getTime()
      );
    });

    // Online MEMBERS: profiles that have heartbeated recently but aren't already
    // represented by a live-room ring above (we dedupe hosts). Presence lookup
    // failures must not break the live-room row, so this is best-effort.
    const hostIds = new Set(live.map((r) => r.host?.id).filter(Boolean));
    let callerId: string | null = null;
    try {
      callerId = (await getRequestMembership(req)).userId;
    } catch {
      /* anonymous / bad token — just don't exclude a caller */
    }

    let members: Array<{
      id: string;
      display_name: string | null;
      username: string | null;
      avatar_url: string | null;
      verified: boolean | null;
      role: string | null;
    }> = [];
    try {
      const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      const { data: online } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url, verified, role")
        .gte("last_seen_at", since)
        .order("last_seen_at", { ascending: false })
        .limit(40);
      members = (online ?? []).filter(
        (m) => m.id !== callerId && !hostIds.has(m.id),
      );
    } catch {
      /* presence is decorative — a failure here still returns live rooms */
    }

    return NextResponse.json(
      { live, members },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
