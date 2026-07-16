import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  liveParticipantCounts,
  withLiveParticipantCounts,
} from "@/lib/spacePresence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mirror/live
// -------------------------------------------------------------------------
// The "online now" ring row at the top of Melori Mirror.
//
// Source of truth = the `spaces` table where status='live'. This is the only
// robust, serverless-friendly signal for "who is live/active on Melori right
// now": Vercel functions are stateless and cannot hold a presence roster, and
// the mm-presence-reap cron already ends empty rooms, so a live row means a
// real, joinable room. Each circle carries the host profile + a deterministic
// room id so tapping it can deep-link straight into the live room.
//
// We intentionally show live-room HOSTS (not every online account): Mirror's
// promise is "tap a ring to join what's happening now," which needs a room to
// enter. Site-wide presence has no room target and is left for later "active
// now" decoration only.
export async function GET() {
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

    // Only surface rooms that actually have a host profile joined; a live row
    // with a missing host can't render a ring or a destination.
    const hosted = (data ?? []).filter((r) => r.host);

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

    return NextResponse.json(
      { live },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
