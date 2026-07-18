import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/connections?kind=friends|family|following|followers
//
// Reuses the existing one-directional follows graph (no separate friend system):
//   * following  → people the caller follows
//   * followers  → people who follow the caller
//   * friends    → MUTUAL follows (reciprocal rows in both directions)
//   * family     → people the caller has tagged with the "family" contact label
//                  (contact_labels), intersected with who they follow
//
// Each entry is hydrated with profile info and an `isFamily` flag so the UI can
// render a "family" toggle inline on the Friends tab.
type Kind = "friends" | "family" | "following" | "followers";

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const supabase = getSupabaseAdmin();

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") ?? "friends") as Kind;

  // Pull both directions of the follow graph + the caller's family labels once.
  const [followingRes, followersRes, familyRes] = await Promise.all([
    supabase.from("follows").select("following_id").eq("follower_id", userId),
    supabase.from("follows").select("follower_id").eq("following_id", userId),
    supabase
      .from("contact_labels")
      .select("contact_id")
      .eq("owner_id", userId)
      .eq("label", "family"),
  ]);

  const following = new Set(
    (followingRes.data ?? []).map((r) => r.following_id),
  );
  const followers = new Set((followersRes.data ?? []).map((r) => r.follower_id));
  const family = new Set((familyRes.data ?? []).map((r) => r.contact_id));

  let ids: string[];
  if (kind === "following") {
    ids = [...following];
  } else if (kind === "followers") {
    ids = [...followers];
  } else if (kind === "family") {
    ids = [...family];
  } else {
    // friends = mutual follows
    ids = [...following].filter((id) => followers.has(id));
  }

  if (ids.length === 0) {
    return NextResponse.json(
      { items: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, role, verified")
    .in("id", ids)
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (profiles ?? []).map((p) => ({
    ...p,
    isFamily: family.has(p.id),
    isFriend: following.has(p.id) && followers.has(p.id),
  }));

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST /api/social/connections  { contact_id, family: boolean } → toggle the
// "family" label on a contact the caller follows. Setting family=true when the
// caller doesn't follow the contact still works (label is independent), but the
// UI only offers it on the Friends list.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const supabase = getSupabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const contactId = String(body?.contact_id ?? "").trim();
  const family = body?.family === true;
  if (!contactId) {
    return NextResponse.json({ error: "contact_id required" }, { status: 400 });
  }
  if (contactId === userId) {
    return NextResponse.json(
      { error: "You can't label yourself" },
      { status: 400 },
    );
  }

  if (family) {
    const { error } = await supabase
      .from("contact_labels")
      .insert({ owner_id: userId, contact_id: contactId, label: "family" });
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from("contact_labels")
      .delete()
      .eq("owner_id", userId)
      .eq("contact_id", contactId)
      .eq("label", "family");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ family });
}
