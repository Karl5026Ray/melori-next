import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/studio/humanize/upload-urls — signed *upload* URLs for up to 15
// WAV stems the artist is about to drag into the Humanizer workspace.
//
// Body: { stems: [{ name: string, type?: string }] }
// Returns: { jobId, urls: [{ name, uploadUrl, path }] }
//
// Mirrors /api/studio/upload-url exactly (createSignedUploadUrl, not
// createSignedUrl — this must be a *writable* URL) but targets the private
// `humanizer-stems` bucket and scopes every path under
// humanize/{userId}/{jobId}/in/{safeName} so a leaked URL can't touch
// another artist's job.
const MAX_STEMS = 15;

export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const rawStems = Array.isArray((body as { stems?: unknown }).stems)
    ? ((body as { stems?: unknown }).stems as unknown[])
    : [];

  if (rawStems.length === 0) {
    return NextResponse.json(
      { error: "stems is required and must be a non-empty array" },
      { status: 400 },
    );
  }
  if (rawStems.length > MAX_STEMS) {
    return NextResponse.json(
      { error: `A maximum of ${MAX_STEMS} stems is supported` },
      { status: 400 },
    );
  }

  const names: string[] = [];
  for (const entry of rawStems) {
    const name =
      entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name
        : null;
    if (!name) {
      return NextResponse.json(
        { error: "Each stem requires a name" },
        { status: 400 },
      );
    }
    names.push(name);
  }

  const bucket = "humanizer-stems";
  const userId = guard.membership.userId!;
  const jobId = randomUUID();

  try {
    const supabase = getSupabaseAdmin();
    const urls: { name: string; uploadUrl: string; path: string }[] = [];

    for (const name of names) {
      const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `humanize/${userId}/${jobId}/in/${safeName}`;
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUploadUrl(path);

      if (error || !data?.signedUrl) {
        console.error("Humanizer signed upload URL error:", error);
        return NextResponse.json(
          { error: "Failed to create upload URL" },
          { status: 500 },
        );
      }

      urls.push({ name, uploadUrl: data.signedUrl, path });
    }

    return NextResponse.json({ jobId, urls, bucket });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Humanizer upload URL error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
