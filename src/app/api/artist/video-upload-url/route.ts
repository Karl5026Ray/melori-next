import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/artist/video-upload-url — signed upload URL for the caller's own
// video file or its thumbnail. Files land in a per-user subfolder so a leaked
// link can't overwrite another artist's uploads (enforced by storage RLS too).
// Body: { filename: string, type: "video" | "thumbnail" }
export async function POST(req: Request) {
const guard = await requireArtist(req);
if (isGuardFailure(guard)) return guard;

const { filename, type } = await req.json().catch(() => ({}) as any);
if (!filename || typeof filename !== "string") {
return NextResponse.json({ error: "filename is required" }, { status: 400 });
}

const isThumb = type === "thumbnail";
const bucket = isThumb ? "thumbnails" : "videos";
const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
const userId = guard.membership.userId!;
const path = `${userId}/${Date.now()}_${safeName}`;

const supabase = getSupabaseAdmin();
const { data, error } = await supabase.storage
.from(bucket)
.createSignedUploadUrl(path);

if (error || !data?.signedUrl) {
console.error("Video signed upload URL error:", error);
return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
}

// thumbnails bucket is public; videos bucket is private (playback uses a
// signed download URL later), so only return a public URL for thumbnails.
let publicUrl: string | null = null;
if (isThumb) {
const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
publicUrl = pub.publicUrl;
}

return NextResponse.json({ signedUrl: data.signedUrl, publicUrl, path, bucket });
}
