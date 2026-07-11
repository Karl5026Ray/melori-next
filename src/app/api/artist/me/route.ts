import { NextResponse } from "next/server";
import { getRequestMembership } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/artist/me — resolve the signed-in caller's own spotlight data.
// Auth is client-side (localStorage), so the browser forwards its access token
// as `Authorization: Bearer <token>`; we identify the user from it and read
// their rows with the service-role client.
//
// Returns their `artists` row (by profile_id) when one exists, plus their
// `profiles` display info as a fallback so a signed-in non-artist can still be
// spotlighted. Either field may be null.
export async function GET(req: Request) {
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ artist: null, profile: null });
  }

  const supabase = getSupabaseAdmin();

  const [{ data: artist }, { data: profile }] = await Promise.all([
    supabase
      .from("artists")
      .select("id, name, slug, avatar_url, bio, is_verified")
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name, full_name, username, avatar_url, bio")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  return NextResponse.json({ artist: artist ?? null, profile: profile ?? null });
}
