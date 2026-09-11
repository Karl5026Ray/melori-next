import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/site-asset-upload?name=<file>
// Headers: x-upload-token: <token>   Body: the raw file bytes.
//
// Puts ONE site asset into the public `images` bucket at site/<name> — the
// door's header photo, the join-page theme song, the WOE picture. Those used
// to need the Supabase dashboard, which only Karl can reach.
//
// Guarded by a single-use token minted in the database (migration 077): only
// its SHA-256 is stored, it is bound to exactly one path, it expires in 15
// minutes, and it is claimed atomically before anything is written. With no
// valid token this route writes nothing.
//
// Limits: lowercase names only, mp3 / jpg / jpeg / png / webp, 4 MB max (the
// Vercel request-body ceiling is 4.5 MB). The content type stored is derived
// from the extension, never taken from the request.

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}\.(mp3|jpg|jpeg|png|webp)$/;
const MAX_BYTES = 4 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-upload-token") ?? "";
  const name = req.nextUrl.searchParams.get("name") ?? "";

  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }
  if (token.length < 32) {
    return NextResponse.json({ error: "Missing upload token." }, { status: 401 });
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 4 MB." }, { status: 413 });
  }

  const path = `site/${name}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = getSupabaseAdmin();

  // Claim first: one unused, unexpired token for exactly this path. A second
  // request with the same token finds used_at already set and gets nothing.
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("site_asset_upload_tokens")
    .update({ used_at: now })
    .eq("token_hash", tokenHash)
    .eq("path", path)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("token_hash")
    .maybeSingle();

  if (claimError || !claimed) {
    return NextResponse.json({ error: "Invalid or expired upload token." }, { status: 401 });
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "Empty file." }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 4 MB." }, { status: 413 });
  }

  const ext = name.slice(name.lastIndexOf(".") + 1);
  const { error: uploadError } = await admin.storage.from("images").upload(path, bytes, {
    contentType: CONTENT_TYPES[ext],
    upsert: true,
    cacheControl: "3600",
  });
  if (uploadError) {
    console.error("[site-asset-upload] storage upload failed", uploadError.message);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }

  const { data } = admin.storage.from("images").getPublicUrl(path);
  return NextResponse.json({ ok: true, path, url: data.publicUrl, bytes: bytes.byteLength });
}
