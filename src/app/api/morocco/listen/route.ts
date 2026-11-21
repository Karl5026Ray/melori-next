import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAudioUrl } from "@/lib/supabase/storagePath";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// /api/morocco/listen — the one full song a visitor to /morocco can play
// without a Melori account: Karl Ray's "Right Love, Right Life" single (3:37,
// studio track Karl picked on Nov 21, 2026). Karl chose this over the Spotify
// embed, which cut non-subscribers off at a preview. Only this track is ever
// served; the regular stream routes still require sign-in for everything else.
const MOROCCO_STUDIO_TRACK_ID = "d383138f-730f-45f3-b063-f4e06aac4d77";
const EXPIRES_IN = 3600;

export async function GET(req: NextRequest) {
  const rl = rateLimit(`morocco-listen:${clientIp(req)}`, 30, 30 / 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many tries. Please wait a minute." }, { status: 429 });
  }

  const admin = getSupabaseAdmin();
  const { data: track, error } = await admin
    .from("studio_tracks")
    .select("id, file_path, file_url")
    .eq("id", MOROCCO_STUDIO_TRACK_ID)
    .eq("status", "published")
    .eq("moderation_status", "clean")
    .maybeSingle();

  const source = track?.file_path || track?.file_url;
  if (error || !source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = await resolveAudioUrl(admin, "audio-files", source, EXPIRES_IN);
  if (!url) return NextResponse.json({ error: "Unavailable" }, { status: 503 });

  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
