import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAudioUrl } from "@/lib/supabase/storagePath";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// /api/morocco/listen — the one full song a visitor to /morocco can play
// without a Melori account: Karl Ray's "Right Love, Right Life" (track 192,
// album "Take It Slow"). Karl chose this over the Spotify embed, which cut
// non-subscribers off at a preview. Only this track id is ever served; the
// regular stream route still requires sign-in for everything else.
const MOROCCO_TRACK_ID = 192;
const EXPIRES_IN = 3600;

export async function GET(req: NextRequest) {
  const rl = rateLimit(`morocco-listen:${clientIp(req)}`, 30, 30 / 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many tries. Please wait a minute." }, { status: 429 });
  }

  const admin = getSupabaseAdmin();
  const { data: track, error } = await admin
    .from("tracks")
    .select("id, audio_url")
    .eq("id", MOROCCO_TRACK_ID)
    .eq("is_published", true)
    .eq("moderation_status", "clean")
    .maybeSingle();

  if (error || !track?.audio_url) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = await resolveAudioUrl(admin, "audio-files", track.audio_url, EXPIRES_IN);
  if (!url) return NextResponse.json({ error: "Unavailable" }, { status: 503 });

  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
