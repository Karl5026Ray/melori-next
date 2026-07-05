import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

// POST /api/admin/upload-url — admin-guarded signed upload URL.
//   type "audio" → bucket `audio-files` (public catalog audio)
//   type "cover" / "image" → bucket `covers` (art / photos)
// Returns { signedUrl, publicUrl, path }. The client PUTs the file to signedUrl.
export async function POST(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }

  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { filename, type } = await req.json();

    if (!filename) {
      return NextResponse.json(
        { error: "filename is required" },
        { status: 400 },
      );
    }

    const bucket = type === "audio" ? "audio-files" : "covers";
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]+/g, "_");
    const path = `${Date.now()}_${safeName}`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      console.error("Admin signed upload URL error:", error);
      return NextResponse.json(
        { error: "Failed to create upload URL" },
        { status: 500 },
      );
    }

    // Only `covers` is public. `audio-files` is private and its public URL
    // would 404 — callers should sign it on demand via /api/tracks/[id]/stream.
    let publicUrl: string | null = null;
    if (bucket === "covers") {
      const { data: publicData } = supabase.storage
        .from(bucket)
        .getPublicUrl(path);
      publicUrl = publicData.publicUrl;
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      publicUrl,
      path,
      bucket,
    });
  } catch (err: any) {
    console.error("Admin upload-url error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Upload URL failed" },
      { status: 500 },
    );
  }
}
