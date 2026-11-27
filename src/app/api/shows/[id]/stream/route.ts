import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAudioUrl } from "@/lib/supabase/storagePath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPIRES_IN = 3 * 3600; // a show hour plus pauses
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/shows/[id]/stream — signed URL for one hour of a Melori Radio show.
//
// NO ACCOUNT NEEDED, and that is deliberate (Karl, 26 Nov 2026: shows are free
// on the front door as advertising). The gate is the row itself: it must be a
// studio upload of type 'show', published and moderation-clean. Only an admin
// can file a show (src/lib/studio-track-type.ts), so a stranger can never use
// this route to reach a song — songs stay behind /api/studio/tracks/[id]/stream.
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const admin = getSupabaseAdmin();
    const { data: row, error } = await admin
      .from("studio_tracks")
      .select("id, file_path, file_url")
      .eq("id", id)
      .eq("type", "show")
      .eq("status", "published")
      .eq("moderation_status", "clean")
      .maybeSingle();
    if (error) throw error;
    const source = row?.file_path ?? row?.file_url;
    if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const url = await resolveAudioUrl(admin, "audio-files", source, EXPIRES_IN);
    if (!url) throw new Error("Could not sign show audio");
    return NextResponse.json(
      { url, expiresIn: EXPIRES_IN },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error(`GET /api/shows/${id}/stream failed:`, err);
    return NextResponse.json({ error: "Show unavailable" }, { status: 500 });
  }
}
