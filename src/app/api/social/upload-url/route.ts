import { NextRequest, NextResponse } from "next/server";
import { getRequestMembership } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/upload-url — signed *upload* URL for any signed-in user to
// post to the social Video feed. Unlike /api/studio/upload-url (artist-gated),
// this only requires a signed-in caller and namespaces every file under
// social/{userId}/ so a leaked link cannot stomp another user's uploads.
//
// Body: { filename: string, type: "video" | "audio" | "thumbnail" }
// - video + audio blobs → public `social-videos` bucket (playable via public URL)
// - thumbnail (cover art) → `covers` bucket
export async function POST(req: NextRequest) {
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const filename = typeof body.filename === "string" ? body.filename : null;
  const type =
    body.type === "thumbnail"
      ? "thumbnail"
      : body.type === "audio"
        ? "audio"
        : "video";

  if (!filename) {
    return NextResponse.json(
      { error: "filename is required" },
      { status: 400 },
    );
  }

  const bucket = type === "thumbnail" ? "covers" : "social-videos";
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `social/${userId}/${Date.now()}_${safeName}`;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      console.error("Social signed upload URL error:", error);
      return NextResponse.json(
        { error: "Failed to create upload URL" },
        { status: 500 },
      );
    }

    const { data: publicData } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return NextResponse.json({
      signedUrl: data.signedUrl,
      publicUrl: publicData.publicUrl,
      path,
      bucket,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Social upload URL error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
