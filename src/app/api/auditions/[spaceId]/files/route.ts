import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";
import {
  AUDITION_DOCS_BUCKET,
  isContextFailure,
  loadAuditionContext,
} from "@/lib/auditions.server";
import {
  auditionFilePath,
  canReadFile,
  canUploadKind,
  isAuditionFileKind,
  normalizeReelUrl,
  validateUpload,
  type AuditionFileKind,
} from "@/lib/auditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ spaceId: string }> };

// Signed read links are short: long enough to open, too short to pass around.
const READ_URL_TTL_SECONDS = 10 * 60;

// GET /api/auditions/[spaceId]/files?id=<fileId>[&download=1]
// A short-lived signed link to one file, if the caller may see it.
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const ctx = await loadAuditionContext((await params).spaceId, guard.membership.userId!);
  if (isContextFailure(ctx)) return ctx;

  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid file" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: file } = await supabase
    .from("audition_files")
    .select("id, owner_id, kind, storage_path, external_url, file_name")
    .eq("id", id)
    .eq("space_id", ctx.room.id)
    .maybeSingle();
  if (
    !file ||
    !canReadFile({
      kind: file.kind as AuditionFileKind,
      ownerId: file.owner_id,
      userId: ctx.userId,
      isDirector: ctx.isDirector,
      isAdmitted: ctx.isInside,
    })
  ) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.external_url) return NextResponse.json({ url: file.external_url });

  const download = req.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await supabase.storage
    .from(AUDITION_DOCS_BUCKET)
    .createSignedUrl(file.storage_path!, READ_URL_TTL_SECONDS, {
      download: download ? file.file_name || true : undefined,
    });
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Could not open the file" }, { status: 500 });
  }
  return NextResponse.json({ url: data.signedUrl });
}

// POST /api/auditions/[spaceId]/files
//   { step: "upload-url", kind, file_name, content_type, size } → signed upload
//   { step: "confirm", kind, path, file_name, content_type, size } → file row
//   { kind: "reel", url }                                        → link row
//
// Two steps so a row only exists for an object that actually arrived.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;
  const ctx = await loadAuditionContext((await params).spaceId, me);
  if (isContextFailure(ctx)) return ctx;
  if (ctx.room.status === "ended") {
    return NextResponse.json({ error: "This session has ended" }, { status: 410 });
  }

  const rl = rateLimit(`auditions:files:${me}`, 10, 0.2);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many uploads. Try again in a moment." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = body.kind;
  if (!isAuditionFileKind(kind)) {
    return NextResponse.json({ error: "Unknown file type" }, { status: 400 });
  }
  if (!canUploadKind(kind, ctx.isDirector)) {
    return NextResponse.json({ error: "Only the director shares scripts" }, { status: 403 });
  }
  const supabase = getSupabaseAdmin();

  if (kind === "reel") {
    const url = normalizeReelUrl(body.url);
    if (!url) {
      return NextResponse.json({ error: "Paste a full https link to your reel" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("audition_files")
      .insert({ space_id: ctx.room.id, owner_id: me, kind, external_url: url, file_name: "Reel" })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: "Could not save the link" }, { status: 500 });
    return NextResponse.json({ id: data.id });
  }

  const fileName = String(body.file_name ?? "").trim().slice(0, 200) || kind;
  const contentType = typeof body.content_type === "string" ? body.content_type : "";
  const size = typeof body.size === "number" ? body.size : 0;
  const check = validateUpload({ kind, mime: contentType, size });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  if (body.step === "upload-url") {
    const path = auditionFilePath(ctx.room.id, me, kind, randomUUID(), check.ext);
    const { data, error } = await supabase.storage
      .from(AUDITION_DOCS_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data?.token) {
      console.error("[auditions/files] upload url failed", error);
      return NextResponse.json({ error: "Could not prepare the upload" }, { status: 500 });
    }
    return NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl });
  }

  if (body.step === "confirm") {
    const path = String(body.path ?? "");
    // The path must be one this route would have issued to THIS caller.
    const prefix = `${ctx.room.id}/${me}/${kind}-`;
    if (!path.startsWith(prefix) || path.includes("..")) {
      return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
    }
    const folder = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const { data: listed } = await supabase.storage
      .from(AUDITION_DOCS_BUCKET)
      .list(folder, { search: name, limit: 1 });
    if (!listed?.some((o) => o.name === name)) {
      return NextResponse.json({ error: "Upload didn't finish. Try again." }, { status: 409 });
    }
    const { data, error } = await supabase
      .from("audition_files")
      .insert({
        space_id: ctx.room.id,
        owner_id: me,
        kind,
        storage_path: path,
        file_name: fileName,
        mime_type: contentType,
        size_bytes: size,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: "Could not save the file" }, { status: 500 });
    return NextResponse.json({ id: data.id });
  }

  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}

// DELETE /api/auditions/[spaceId]/files?id= — the owner (or director) removes a file.
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const ctx = await loadAuditionContext((await params).spaceId, guard.membership.userId!);
  if (isContextFailure(ctx)) return ctx;
  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid file" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: file } = await supabase
    .from("audition_files")
    .select("id, owner_id, storage_path")
    .eq("id", id)
    .eq("space_id", ctx.room.id)
    .maybeSingle();
  if (!file || (file.owner_id !== ctx.userId && !ctx.isDirector)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.storage_path) {
    await supabase.storage.from(AUDITION_DOCS_BUCKET).remove([file.storage_path]);
  }
  await supabase.from("audition_files").delete().eq("id", file.id);
  return NextResponse.json({ ok: true });
}
