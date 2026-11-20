import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { jwtVerify } from "jose";
import { getAdminSecret } from "@/lib/admin-secret";

// Always run this route dynamically at request time. It reads cookies and
// queries Supabase, so it must never be statically evaluated during `next build`.
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

  try {
    const supabase = createServiceClient();

    const results = await Promise.all([
      supabase.from("tracks").select("*", { count: "exact", head: true }),
      supabase.from("releases").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("artists").select("*", { count: "exact", head: true }),
      supabase.from("spaces").select("*", { count: "exact", head: true }),
      supabase
        .from("track_submissions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);
    const [tracks, releases, profiles, artists, spaces, pendingSubs] = results;
    // Surface failed counts instead of silently showing 0, so a broken table
    // can't masquerade as "nothing here".
    const labels = ["tracks", "releases", "members", "artists", "spaces", "submissions"];
    const failed = results
      .map((r, i) => (r.error ? labels[i] : null))
      .filter((x): x is string => x !== null);
    if (failed.length) console.error("Admin stats: some counts failed:", failed);

    return NextResponse.json({
      totalMembers: profiles.count ?? 0,
      totalArtists: artists.count ?? 0,
      totalTracks: tracks.count ?? 0,
      totalReleases: releases.count ?? 0,
      totalSpaces: spaces.count ?? 0,
      pendingSubmissions: pendingSubs.count ?? 0,
      failed,
    });
  } catch (err: any) {
    console.error("Admin stats error:", err);
    return NextResponse.json({ error: "Could not load stats" }, { status: 500 });
  }
}
