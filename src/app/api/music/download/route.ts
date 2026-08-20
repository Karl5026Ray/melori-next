import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_BUCKET = "audio-files";
const SIGNED_TTL_SECONDS = 600; // 10 minutes

// GET /api/music/download?session_id=... — after a paid music purchase, hand
// back short-lived signed download URLs for the purchased audio. The webhook
// records the paid row in music_purchases; we verify it (status 'paid') before
// signing the private audio objects.
//
// A single-track purchase returns one file; an album purchase returns every
// published track on the release.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  const { data: purchase, error } = await supabase
    .from("music_purchases")
    .select(
      "id, release_id, track_id, studio_track_id, studio_album_id, item_name, status",
    )
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("music/download purchase lookup failed", error.message);
    return NextResponse.json(
      { error: "Could not verify purchase" },
      { status: 500 },
    );
  }

  // No row yet: the webhook may not have landed. 402 tells the client to retry.
  if (!purchase || purchase.status !== "paid") {
    return NextResponse.json(
      { error: "Payment not confirmed yet. Please try again in a moment." },
      { status: 402 },
    );
  }

  // Collect the audio objects to sign.
  const files: { title: string; audio_url: string }[] = [];

  // Artist self-uploads live in studio_tracks and keep their master in
  // `file_path` (bucket-relative) rather than the legacy `audio_url`.
  if (purchase.studio_track_id) {
    const { data: track } = await supabase
      .from("studio_tracks")
      .select("title, file_path, moderation_status")
      .eq("id", purchase.studio_track_id)
      .eq("moderation_status", "clean")
      .maybeSingle();
    // No row here means the track was taken down: a DMCA removal has to
    // disable access for everyone, buyers included. The purchase record is
    // untouched, so the sale can still be refunded or re-delivered on
    // reinstatement.
    if (track?.file_path) {
      files.push({ title: track.title ?? "track", audio_url: track.file_path });
    }
  } else if (purchase.studio_album_id) {
    const { data: album } = await supabase
      .from("studio_albums")
      .select("title, profile_id")
      .eq("id", purchase.studio_album_id)
      .maybeSingle();
    if (album) {
      const { data: tracks } = await supabase
        .from("studio_tracks")
        .select("title, file_path, sort_order")
        .eq("profile_id", (album as { profile_id: string }).profile_id)
        .eq("album", (album as { title: string }).title)
        .eq("status", "published")
        .eq("moderation_status", "clean")
        .order("sort_order", { ascending: true, nullsFirst: false });
      for (const t of (tracks ?? []) as Array<{
        title: string | null;
        file_path: string | null;
      }>) {
        if (t.file_path) {
          files.push({ title: t.title ?? "track", audio_url: t.file_path });
        }
      }
    }
  } else if (purchase.track_id) {
    const { data: track } = await supabase
      .from("tracks")
      .select("title, audio_url")
      .eq("id", purchase.track_id)
      .maybeSingle();
    if (track?.audio_url) {
      files.push({ title: track.title ?? "track", audio_url: track.audio_url });
    }
  } else if (purchase.release_id) {
    const { data: tracks } = await supabase
      .from("tracks")
      .select("title, audio_url, track_number, is_published")
      .eq("release_id", purchase.release_id)
      .order("track_number", { ascending: true });
    for (const t of tracks ?? []) {
      if (t.is_published !== false && t.audio_url) {
        files.push({ title: t.title ?? "track", audio_url: t.audio_url });
      }
    }
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No downloadable files were found for this purchase." },
      { status: 404 },
    );
  }

  // Sign each private object. `audio_url` is the bucket-relative object key.
  const downloads: { title: string; url: string }[] = [];
  for (const f of files) {
    const filename = f.audio_url.split("/").pop() || `${f.title}`;
    const { data: signed, error: signErr } = await supabase.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(f.audio_url, SIGNED_TTL_SECONDS, { download: filename });
    if (signErr || !signed?.signedUrl) {
      console.error("music/download sign failed", f.audio_url, signErr?.message);
      continue;
    }
    downloads.push({ title: f.title, url: signed.signedUrl });
  }

  if (downloads.length === 0) {
    return NextResponse.json(
      { error: "Could not prepare the download. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    item: purchase.item_name || "Your purchase",
    downloads,
  });
}
