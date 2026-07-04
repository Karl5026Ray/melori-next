import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/profile/upload-url — Signed upload URL for a user's own
// avatar. Bucket is `covers` (already used by the admin flow), path is
// namespaced under `avatars/<userId>/…` so the same user can overwrite
// their own object and can't collide with anyone else's.
export async function POST(req: NextRequest) {
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const filename = String(body?.filename ?? "").trim();
  if (!filename) {
    return NextResponse.json(
      { error: "filename is required" },
      { status: 400 },
    );
  }
  const contentType = String(body?.contentType ?? "");
  if (contentType && !contentType.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image uploads are allowed" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `avatars/${userId}/${Date.now()}_${safeName}`;

  const { data, error } = await supabase.storage
    .from("covers")
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    console.error("Social avatar signed upload URL error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to create upload URL" },
      { status: 500 },
    );
  }

  const { data: publicData } = supabase.storage
    .from("covers")
    .getPublicUrl(path);

  return NextResponse.json({
    signedUrl: data.signedUrl,
    publicUrl: publicData.publicUrl,
    path,
    bucket: "covers",
  });
}
