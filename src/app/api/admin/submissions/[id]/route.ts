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

// PATCH /api/admin/submissions/[id]
//   { action: "approve" | "reject", notes?: string }
//
// On approve: create a lightweight release + track shell so the audio shows up
// in the catalog. Admin can later fill in cover art, tracklist, price, etc.
// via /admin/tracks. On reject: just mark the row and stash the reviewer note.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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

  const { action, notes } = await req.json().catch(() => ({}) as any);
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: sub, error: subErr } = await supabase
    .from("track_submissions")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (subErr || !sub) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }
  if (sub.status !== "pending") {
    return NextResponse.json(
      { error: `Already ${sub.status}` },
      { status: 409 },
    );
  }

  if (action === "reject") {
    const { error } = await supabase
      .from("track_submissions")
      .update({
        status: "rejected",
        reviewer_notes: notes ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", params.id);
    if (error) {
      console.error("Reject submission error:", error);
      return NextResponse.json({ error: "Failed to reject" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // action === "approve" → create release + track shell.
  // If the submitter isn't linked to an artist yet, we skip release creation
  // and just mark approved; admin can attach the artist later.
  let approvedTrackId: number | null = null;

  if (sub.artist_id) {
    // Build a URL-safe slug.
    const baseSlug =
      String(sub.title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || `track-${Date.now()}`;
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data: release, error: relErr } = await supabase
      .from("releases")
      .insert({
        title: sub.title,
        slug,
        artist_id: sub.artist_id,
        release_type: sub.release_type,
        description: sub.description,
        cover_art_url: sub.cover_url,
        release_date: new Date().toISOString().slice(0, 10),
        is_published: false, // admin still needs to publish
      })
      .select("id")
      .single();

    if (relErr || !release) {
      console.error("Release create on approve failed:", relErr);
      return NextResponse.json({ error: "Failed to create release" }, { status: 500 });
    }

    const { data: track, error: trackErr } = await supabase
      .from("tracks")
      .insert({
        title: sub.title,
        release_id: release.id,
        track_number: 1,
        duration_seconds: sub.duration_sec ?? null,
        audio_url: sub.audio_url,
        is_published: false,
      })
      .select("id")
      .single();

    if (trackErr || !track) {
      console.error("Track create on approve failed:", trackErr);
      return NextResponse.json({ error: "Failed to create track" }, { status: 500 });
    }
    approvedTrackId = track.id;
  }

  const { error: updateErr } = await supabase
    .from("track_submissions")
    .update({
      status: "approved",
      reviewer_notes: notes ?? null,
      reviewed_at: new Date().toISOString(),
      approved_track_id: approvedTrackId,
    })
    .eq("id", params.id);

  if (updateErr) {
    console.error("Approve submission update failed:", updateErr);
    return NextResponse.json({ error: "Approval saved but status update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "approved", approved_track_id: approvedTrackId });
}
