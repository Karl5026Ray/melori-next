import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ensureArtistRow } from "@/lib/artist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/artist/ensure-row — self-heal endpoint for the studio/dashboard.
// Guarded by requireArtist, so only artist-tier members reach the helper. Creates
// the caller's linked `artists` row if it's missing (idempotent). The Studio
// gate calls this on load so existing artists get backfilled without manual DB
// work.
export async function POST(req: Request) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const result = await ensureArtistRow(userId, {}, getSupabaseAdmin());

  if (!result.id) {
    return NextResponse.json(
      { error: result.error ?? "Could not ensure artist row" },
      { status: 500 },
    );
  }

  return NextResponse.json({ artistId: result.id, created: result.created });
}
