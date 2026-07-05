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

// GET /api/admin/submissions?status=pending|approved|rejected|all
// List submissions in the admin review queue.
export async function GET(req: NextRequest) {
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

  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("track_submissions")
    .select(
      "id, title, release_type, genre, description, audio_url, cover_url, status, created_at, reviewer_notes, reviewed_at, artist_id, profile_id, approved_track_id",
    )
    .order("created_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data: submissions, error } = await query;
  if (error) {
    console.error("List admin submissions error:", error);
    return NextResponse.json({ error: "Failed to load queue" }, { status: 500 });
  }

  // Batch-load submitter profiles so the admin UI can show names/emails.
  const profileIds = Array.from(
    new Set((submissions ?? []).map((s: any) => s.profile_id).filter(Boolean)),
  );
  const profilesByIdPromise = profileIds.length
    ? supabase
        .from("profiles")
        .select("id, username, display_name, full_name, avatar_url")
        .in("id", profileIds)
    : Promise.resolve({ data: [] as any[] });

  const artistIds = Array.from(
    new Set((submissions ?? []).map((s: any) => s.artist_id).filter(Boolean)),
  );
  const artistsByIdPromise = artistIds.length
    ? supabase.from("artists").select("id, name, slug").in("id", artistIds)
    : Promise.resolve({ data: [] as any[] });

  const [{ data: profiles }, { data: artists }] = await Promise.all([
    profilesByIdPromise,
    artistsByIdPromise,
  ]);

  const profilesMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
  const artistsMap = Object.fromEntries((artists ?? []).map((a: any) => [a.id, a]));

  return NextResponse.json({
    submissions: (submissions ?? []).map((s: any) => ({
      ...s,
      profile: profilesMap[s.profile_id] ?? null,
      artist: s.artist_id ? artistsMap[s.artist_id] ?? null : null,
    })),
  });
}
