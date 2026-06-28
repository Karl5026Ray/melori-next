import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPIRES_IN = 3600;

// GET /api/tracks/[id]/stream — a short-lived signed URL for the track's audio file
// in the private `audio-files` bucket. tracks.audio_url holds the bucket-relative path.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: track, error } = await supabaseAdmin
      .from("tracks")
      .select("id, audio_url, is_published")
      .eq("id", id)
      .eq("is_published", true)
      .maybeSingle();

    if (error) throw error;
    if (!track || !track.audio_url) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from("audio-files")
      .createSignedUrl(track.audio_url, EXPIRES_IN);

    if (signError) throw signError;
    if (!signed?.signedUrl) {
      throw new Error("Signed URL generation returned no URL");
    }

    return NextResponse.json({ url: signed.signedUrl, expiresIn: EXPIRES_IN });
  } catch (err) {
    console.error(`GET /api/tracks/${params.id}/stream failed:`, err);
    return NextResponse.json(
      { error: "Failed to create stream URL" },
      { status: 500 },
    );
  }
}
