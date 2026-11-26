import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAudioUrl } from "@/lib/supabase/storagePath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/mirror/audio?path=previews/<file>.mp3 — 302 to a short-lived signed
// URL for a Mirror audio post stored as a bare `audio-files` key.
//
// Karl, 26 Nov 2026: the `audio-files` bucket goes private, so the old
// `/object/public/audio-files/<key>` fallback in VideoCard stops working.
// Deliberately narrow: only 30-second clips under `previews/` — never masters.
const ALLOWED = /^previews\/[A-Za-z0-9._-]+\.(mp3|m4a|aac|wav|ogg)$/;
const TTL_SECONDS = 60 * 60;

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!ALLOWED.test(path)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = await resolveAudioUrl(getSupabaseAdmin(), "audio-files", path, TTL_SECONDS);
  if (!url) {
    return NextResponse.json({ error: "Audio unavailable" }, { status: 502 });
  }
  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
