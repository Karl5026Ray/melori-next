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
    .select("id, release_id, track_id, item_name, status")
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

  if (purchase.track_id) {
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
