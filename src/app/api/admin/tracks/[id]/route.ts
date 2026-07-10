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

// PATCH /api/admin/tracks/[id] — update editable fields (incl. preview window).
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
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
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json().catch(() => ({}));
    const update: Record<string, any> = {};
    // Bound free-form strings; reject rather than silently truncate so admins
    // notice accidental oversized pastes.
    if (typeof body.title === "string") {
      const t = body.title.trim();
      if (t.length > 200) {
        return NextResponse.json({ error: "title too long (max 200)" }, { status: 400 });
      }
      update.title = t;
    }
    if (typeof body.is_published === "boolean")
      update.is_published = body.is_published;
    if (typeof body.preview_url === "string") {
      const p = body.preview_url.trim();
      if (p.length > 2048) {
        return NextResponse.json({ error: "preview_url too long (max 2048)" }, { status: 400 });
      }
      update.preview_url = p || null;
    } else if (body.preview_url === null) update.preview_url = null;
    if (body.price != null && body.price !== "") {
      const p = Number(body.price);
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json({ error: "Invalid price" }, { status: 400 });
      }
      update.price = p;
    }
    if (typeof body.audio_url === "string" && body.audio_url.trim()) {
      const a = body.audio_url.trim();
      if (a.length > 2048) {
        return NextResponse.json({ error: "audio_url too long (max 2048)" }, { status: 400 });
      }
      update.audio_url = a;
    }
    if (body.duration_seconds != null) {
      const d = Number(body.duration_seconds);
      if (Number.isFinite(d) && d > 0) update.duration_seconds = Math.round(d);
    }
    // track_number lets an admin arrange the running order of songs within a
    // release. Accept any non-negative integer; the Release Manager sends the
    // new position when reordering tracks up/down.
    if (body.track_number != null) {
      const n = Number(body.track_number);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json({ error: "Invalid track_number" }, { status: 400 });
      }
      update.track_number = n;
    }
    if (body.preview_start != null) {
      const s = Number(body.preview_start);
      if (Number.isFinite(s) && s >= 0) update.preview_start = s;
    }
    if (body.preview_end != null) {
      const e = Number(body.preview_end);
      if (Number.isFinite(e) && e >= 0) update.preview_end = e;
    }
    if (
      update.preview_start != null &&
      update.preview_end != null &&
      update.preview_end <= update.preview_start
    ) {
      update.preview_end = update.preview_start + 30;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    // Enforce a dedicated preview clip whenever a track goes live. Without
    // one, /api/tracks/[id]/stream falls back to serving the full audio to
    // free listeners with only a client-side 30s cap — which is cosmetic
    // (the signed URL is directly fetchable). Publishing is the right
    // gate: unpublished tracks aren't served to free listeners anyway.
    if (update.is_published === true) {
      // preview_url may come from this same PATCH, or already exist on the row.
      let effectivePreview: string | null | undefined = update.preview_url;
      if (effectivePreview === undefined) {
        const { data: existing } = await supabase
          .from("tracks")
          .select("preview_url")
          .eq("id", id)
          .maybeSingle();
        effectivePreview = existing?.preview_url ?? null;
      }
      if (!effectivePreview) {
        return NextResponse.json(
          {
            error:
              "Cannot publish: this track has no preview clip. Generate a preview from the Music Manager before publishing.",
          },
          { status: 400 },
        );
      }
    }
    const { error } = await supabase.from("tracks").update(update).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`PATCH /api/admin/tracks/${params.id} failed:`, err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to update track" },
      { status: 500 },
    );
  }
}

// Given a Supabase storage value, return { bucket, path } ready for
// storage.from(bucket).remove([path]).
//
// tracks.audio_url and tracks.preview_url are stored as BUCKET-RELATIVE paths
// inside the private `audio-files` bucket (e.g. "submissions/<uid>/123_x.mp3"
// or "kaiel-r/women-only/01-328-preview.mp3"). releases.cover_art_url, by
// contrast, is a FULL public URL that may live in EITHER the `covers` or the
// `images` bucket depending on when/how it was uploaded. So we detect the two
// shapes: an absolute http(s) URL is parsed for its bucket+path; anything else
// is treated as an already-relative path in the supplied default bucket.
function resolveStorageTarget(
  value: string | null | undefined,
  defaultBucket: string,
): { bucket: string; path: string } | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const marker = "/object/public/";
  const idx = trimmed.indexOf(marker);
  if (idx !== -1) {
    // Absolute public URL: everything after the marker is "<bucket>/<path>".
    const rest = trimmed.slice(idx + marker.length);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    const bucket = rest.slice(0, slash);
    const path = decodeURIComponent(rest.slice(slash + 1));
    if (!bucket || !path) return null;
    return { bucket, path };
  }
  // Reject any other absolute URL shape we don't understand rather than
  // guessing — better to leave an orphan than to remove the wrong object.
  if (/^https?:\/\//i.test(trimmed)) return null;
  // Relative path in the default bucket. Guard against path traversal.
  if (trimmed.includes("..")) return null;
  return { bucket: defaultBucket, path: trimmed };
}

// DELETE /api/admin/tracks/[id] — DESTRUCTIVE: remove a track row and clean up
// its storage artifacts (master audio + preview clip). If this track is the
// LAST track on its release, the now-empty release and its cover art are
// removed too, so "discard a song and cover" fully cleans up. When other tracks
// still share the release, the release + shared cover art are preserved (they
// belong to the album, not this single song).
//
// Order: read the row first (so we know which files to clean), delete the DB
// row (the source of truth), THEN delete storage objects. If storage cleanup
// partially fails we still return ok:true with a `storageErrors` array — the
// row is already gone from every listing, and retrying the DELETE would 404.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
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
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const supabase = getSupabaseAdmin();
    // 1. Read the artifacts we need to clean up before the row disappears.
    const { data: track, error: readErr } = await supabase
      .from("tracks")
      .select("id, release_id, audio_url, preview_url")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }
    // 2. Decide whether this is the last track on its release. If so we can
    //    also remove the release + its cover art; otherwise the cover belongs
    //    to sibling tracks and must be preserved.
    let isLastOnRelease = false;
    if (track.release_id != null) {
      const { count } = await supabase
        .from("tracks")
        .select("id", { count: "exact", head: true })
        .eq("release_id", track.release_id);
      isLastOnRelease = (count ?? 0) <= 1;
    }
    // 3. Delete the track row — the definitive user-visible record.
    const { error: delErr } = await supabase.from("tracks").delete().eq("id", id);
    if (delErr) throw delErr;
    const storageErrors: string[] = [];
    const removeTarget = async (
      value: string | null | undefined,
      defaultBucket: string,
      label: string,
    ) => {
      const target = resolveStorageTarget(value, defaultBucket);
      if (!target) return;
      const { error } = await supabase.storage
        .from(target.bucket)
        .remove([target.path]);
      if (error) storageErrors.push(`${label}:${error.message}`);
    };
    // 4. Master audio + preview clip both live in the private audio-files bucket.
    await removeTarget(track.audio_url, "audio-files", "audio");
    await removeTarget(track.preview_url, "audio-files", "preview");
    // 5. Cover art + empty release, only when nothing else references them.
    let removedRelease = false;
    if (isLastOnRelease && track.release_id != null) {
      const { data: rel } = await supabase
        .from("releases")
        .select("cover_art_url")
        .eq("id", track.release_id)
        .maybeSingle();
      // Cover URLs may be in `covers` OR `images`; resolveStorageTarget reads
      // the bucket straight out of the URL, so the default is only a fallback.
      await removeTarget(rel?.cover_art_url, "covers", "cover");
      const { error: relDelErr } = await supabase
        .from("releases")
        .delete()
        .eq("id", track.release_id);
      if (relDelErr) {
        storageErrors.push(`release:${relDelErr.message}`);
      } else {
        removedRelease = true;
      }
    }
    return NextResponse.json({
      ok: true,
      removedRelease,
      storageErrors: storageErrors.length ? storageErrors : undefined,
    });
  } catch (err: any) {
    console.error(`DELETE /api/admin/tracks/${params.id} failed:`, err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete track" },
      { status: 500 },
    );
  }
}
