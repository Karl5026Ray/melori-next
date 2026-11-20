import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { jwtVerify } from "jose";
import { getSupabaseAdmin, PUBLIC_CATALOG_TAG } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";
import {
  EXPLICIT_REPORT_TYPE,
  autoMarkThreshold,
  getFlaggableTrack,
  removeTrack,
  setTrackExplicit,
  trackRefFromKey,
} from "@/lib/explicit-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("admin_session")?.value;
  const secret = getAdminSecret();
  if (!token || !secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

async function guard(req: NextRequest): Promise<NextResponse | null> {
  if (!getAdminSecret()) {
    return NextResponse.json({ error: "Admin auth is not configured." }, { status: 503 });
  }
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// GET /api/admin/explicit-reports
//   Open listener "Report as explicit" flags, grouped by track, most-flagged
//   first: { items: [{ key, sourceType, id, title, artist, explicit, public,
//   flags, lastFlaggedAt }], autoMarkThreshold }
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_reports")
    .select("content_id, created_at")
    .eq("content_type", EXPLICIT_REPORT_TYPE)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const groups = new Map<string, { flags: number; lastFlaggedAt: string }>();
  for (const row of (data ?? []) as { content_id: string | null; created_at: string }[]) {
    if (!row.content_id) continue;
    const g = groups.get(row.content_id);
    if (g) g.flags += 1;
    else groups.set(row.content_id, { flags: 1, lastFlaggedAt: row.created_at });
  }

  const items = (
    await Promise.all(
      Array.from(groups.entries()).map(async ([key, g]) => {
        const ref = trackRefFromKey(key);
        if (!ref) return null;
        const track = await getFlaggableTrack(supabase, ref);
        return {
          key,
          sourceType: ref.sourceType,
          id: String(ref.id),
          title: track?.title ?? "(deleted track)",
          artist: track?.artist ?? null,
          explicit: track?.explicit ?? false,
          public: track?.public ?? false,
          flags: g.flags,
          lastFlaggedAt: g.lastFlaggedAt,
        };
      }),
    )
  )
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.flags - a.flags || b.lastFlaggedAt.localeCompare(a.lastFlaggedAt));

  return NextResponse.json({ items, autoMarkThreshold: autoMarkThreshold() });
}

// POST /api/admin/explicit-reports
//   { key: 'studio:<uuid>'|'legacy:<int>', action: 'mark_explicit'|'remove'|'dismiss' }
//   - mark_explicit : track gets the E badge (and leaves the homepage radio)
//   - remove        : track taken down (moderation_status 'removed', reversible)
//   - dismiss       : flags closed, track unchanged
//   Every open flag on that track is closed either way.
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const key = typeof body.key === "string" ? body.key : "";
  const action = String(body.action ?? "");
  const ref = trackRefFromKey(key);
  if (!ref || !["mark_explicit", "remove", "dismiss"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  if (action === "mark_explicit") {
    const { error } = await setTrackExplicit(supabase, ref, true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (action === "remove") {
    const { error } = await removeTrack(
      supabase,
      ref,
      "Explicit content not labeled (listener reports)",
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: closeErr } = await supabase
    .from("content_reports")
    .update({
      status: action === "dismiss" ? "dismissed" : "actioned",
      reviewed_at: new Date().toISOString(),
    })
    .eq("content_type", EXPLICIT_REPORT_TYPE)
    .eq("content_id", key)
    .eq("status", "open");
  if (closeErr) {
    console.error("Explicit report close error:", closeErr);
    return NextResponse.json({ error: closeErr.message }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    action: `explicit_report_${action}`,
    table_name: ref.sourceType === "studio" ? "studio_tracks" : "tracks",
    record_id: ref.sourceType === "legacy" ? ref.id : null,
    new_data: { key, action },
  });

  if (action !== "dismiss") {
    revalidateTag(PUBLIC_CATALOG_TAG, "max");
    revalidatePath("/");
    revalidatePath("/music");
    revalidatePath("/artists");
    if (ref.sourceType === "studio") revalidatePath(`/music/${ref.id}`);
  }

  return NextResponse.json({ ok: true });
}
