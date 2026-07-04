import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/artist/upload-url — signed upload URL for the caller's own audio
// or cover art. Artists get their own subfolder so a leaked link can't stomp
// on another artist's files.
//
// Body: { filename: string, type: "audio" | "cover" }
export async function POST(req: Request) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const { filename, type } = await req.json().catch(() => ({}) as any);
  if (!filename || typeof filename !== "string") {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }

  const bucket = type === "audio" ? "audio-files" : "covers";
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const userId = guard.membership.userId!;
  const path = `submissions/${userId}/${Date.now()}_${safeName}`;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    console.error("Artist signed upload URL error:", error);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
  return NextResponse.json({
    signedUrl: data.signedUrl,
    publicUrl: publicData.publicUrl,
    path,
    bucket,
  });
}
