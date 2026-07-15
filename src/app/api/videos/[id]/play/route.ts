import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/videos/[id]/play — returns a short-lived signed playback URL for a
// published native video and records a play event. Public (no auth) so fans
// can watch, but the underlying file stays private in storage.
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
  return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: video, error } = await supabase
  .from("videos")
  .select("id, file_path, source, is_active, status")
  .eq("id", id)
  .maybeSingle();

  if (error || !video || !video.is_active || video.status !== "published") {
  return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (video.source !== "native" || !video.file_path) {
  return NextResponse.json({ error: "no native file" }, { status: 400 });
  }

  // 1-hour signed URL from the private videos bucket.
  const { data: signed, error: signErr } = await supabase.storage
  .from("videos")
  .createSignedUrl(video.file_path, 3600);

  if (signErr || !signed?.signedUrl) {
  console.error("Playback sign error:", signErr);
  return NextResponse.json({ error: "failed to sign" }, { status: 500 });
  }

  // Record analytics: a play row + increment the denormalized views counter.
  await supabase.from("video_plays").insert({ video_id: id });
  await supabase.rpc("increment_video_views", { p_video_id: id }).then(
  () => {},
  async () => {
  // fallback if RPC not present: best-effort direct update
  const { data: cur } = await supabase.from("videos").select("views").eq("id", id).maybeSingle();
  await supabase.from("videos").update({ views: (cur?.views ?? 0) + 1 }).eq("id", id);
  }
  );

  return NextResponse.json({ url: signed.signedUrl });
}
