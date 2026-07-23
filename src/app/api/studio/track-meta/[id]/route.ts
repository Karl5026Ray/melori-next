import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/studio/track-meta/[id]   → { lyrics, credits_text, credits[] }
// PATCH /api/studio/track-meta/[id]  → update lyrics/credits_text + rewrite credits[]
// id = tracks.id (integer). Ownership: track → release → artist.profile_id === userId.

interface CreditInput {
  role?: string;
  name?: string;
}

// Confirm the caller owns the track via its release's artist profile_id.
async function resolveOwnedTrack(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  trackId: number,
  userId: string,
): Promise<boolean> {
  const { data: track } = await supabase
    .from("tracks")
    .select("id, release_id")
    .eq("id", trackId)
    .maybeSingle();
  if (!track?.release_id) return false;

  const { data: release } = await supabase
    .from("releases")
    .select("id, artist_id")
    .eq("id", track.release_id)
    .maybeSingle();
  if (!release?.artist_id) return false;

  const { data: artist } = await supabase
    .from("artists")
    .select("id, profile_id")
    .eq("id", release.artist_id)
    .maybeSingle();
  return artist?.profile_id === userId;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId!;

  const { id } = await ctx.params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) {
    return NextResponse.json({ error: "Invalid track id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!(await resolveOwnedTrack(supabase, trackId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: track } = await supabase
    .from("tracks")
    .select("lyrics, credits_text")
    .eq("id", trackId)
    .maybeSingle();

  const { data: credits } = await supabase
    .from("track_credits")
    .select("role, name, order_index")
    .eq("track_id", trackId)
    .order("order_index", { ascending: true });

  return NextResponse.json({
    lyrics: track?.lyrics ?? "",
    credits_text: track?.credits_text ?? "",
    credits: (credits ?? []).map((c) => ({ role: c.role, name: c.name })),
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId!;

  const { id } = await ctx.params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) {
    return NextResponse.json({ error: "Invalid track id" }, { status: 400 });
  }

  let body: {
    lyrics?: string;
    credits_text?: string;
    credits?: CreditInput[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!(await resolveOwnedTrack(supabase, trackId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update: { lyrics?: string; credits_text?: string } = {};
  if (typeof body.lyrics === "string") update.lyrics = body.lyrics;
  if (typeof body.credits_text === "string") update.credits_text = body.credits_text;
  if (Object.keys(update).length > 0) {
    const { error } = await supabase
      .from("tracks")
      .update(update)
      .eq("id", trackId);
    if (error) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  }

  // Rewrite structured credits: delete existing then insert the new ordered set.
  if (Array.isArray(body.credits)) {
    await supabase.from("track_credits").delete().eq("track_id", trackId);
    const rows = body.credits
      .map((c, index) => ({
        track_id: trackId,
        role: (c.role ?? "").trim(),
        name: (c.name ?? "").trim(),
        order_index: index,
      }))
      .filter((r) => r.role && r.name);
    if (rows.length > 0) {
      const { error } = await supabase.from("track_credits").insert(rows);
      if (error) {
        return NextResponse.json(
          { error: "Credits update failed" },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}
