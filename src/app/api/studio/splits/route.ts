import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { OWNER_COLUMN } from "@/lib/studio-ownership";
import { splitTargetColumn, type MusicItemKind } from "@/lib/music-items";
import { validateSplits } from "@/lib/revenue-splits";

export const dynamic = "force-dynamic";

// Collaborator revenue splits for one catalog item.
//
// The whole feature is optional: an item with no rows here pays 100% to the
// uploading artist through the same destination charge it always used. The
// owner's share is never stored — it is 100% minus whatever collaborators
// take — so the two can never drift out of sync.

const KINDS: MusicItemKind[] = ["studio_track", "studio_album", "release", "track"];

function parseKind(value: unknown): MusicItemKind | null {
  return KINDS.includes(value as MusicItemKind) ? (value as MusicItemKind) : null;
}

// Only the owning artist (or an admin, already allowed through requireArtist's
// admin path) may read or write an item's splits.
async function ownsItem(
  supabase: SupabaseClient,
  kind: MusicItemKind,
  itemId: string,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  if (kind === "studio_track") {
    const { data } = await supabase
      .from("studio_tracks")
      .select("id")
      .eq("id", itemId)
      .eq(OWNER_COLUMN, userId)
      .maybeSingle();
    return Boolean(data);
  }
  if (kind === "studio_album") {
    const { data } = await supabase
      .from("studio_albums")
      .select("id")
      .eq("id", itemId)
      .eq("profile_id", userId)
      .maybeSingle();
    return Boolean(data);
  }

  // Legacy releases/tracks hang off `artists`, which carries the profile id.
  const { data: artist } = await supabase
    .from("artists")
    .select("id")
    .eq("profile_id", userId)
    .maybeSingle();
  const artistId = (artist as { id: number } | null)?.id;
  if (!artistId) return false;

  if (kind === "release") {
    const { data } = await supabase
      .from("releases")
      .select("id")
      .eq("id", Number(itemId))
      .eq("artist_id", artistId)
      .maybeSingle();
    return Boolean(data);
  }

  const { data } = await supabase
    .from("tracks")
    .select("id, release:releases!inner(artist_id)")
    .eq("id", Number(itemId))
    .eq("releases.artist_id", artistId)
    .maybeSingle();
  return Boolean(data);
}

// GET /api/studio/splits?kind=studio_album&id=<uuid>
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  const itemId = req.nextUrl.searchParams.get("id");
  if (!kind || !itemId) {
    return NextResponse.json({ error: "kind and id are required." }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!(await ownsItem(supabase, kind, itemId, guard.membership.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const column = splitTargetColumn(kind);
  const value = kind === "release" || kind === "track" ? Number(itemId) : itemId;
  const { data, error } = await supabase
    .from("revenue_splits")
    .select("id, basis_points, payee_profile_id, payee_email, payee_name")
    .eq(column, value as never)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    basis_points: number;
    payee_profile_id: string | null;
    payee_email: string | null;
    payee_name: string;
  }>;

  // Hand the username back so the editor can round-trip a linked member
  // rather than downgrading them to an email-only payee on the next save.
  const profileIds = rows
    .map((r) => r.payee_profile_id)
    .filter((id): id is string => Boolean(id));
  const usernames = new Map<string, string | null>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", profileIds);
    for (const p of (profiles ?? []) as Array<{ id: string; username: string | null }>) {
      usernames.set(p.id, p.username);
    }
  }

  return NextResponse.json({
    splits: rows.map((r) => ({
      ...r,
      payee_username: r.payee_profile_id
        ? usernames.get(r.payee_profile_id) ?? null
        : null,
    })),
  });
}

interface IncomingSplit {
  basis_points?: unknown;
  payee_email?: unknown;
  payee_name?: unknown;
  payee_username?: unknown;
}

// PUT /api/studio/splits — replace the entire collaborator set for one item.
//
// Replace rather than patch: the set has a single invariant (collaborators take
// at most 100%) that can only be checked as a whole, and a partial update could
// transiently leave the item over-allocated.
export async function PUT(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const body = await req.json().catch(() => ({}));
  const kind = parseKind(body.kind);
  const itemId = typeof body.id === "string" ? body.id : null;
  if (!kind || !itemId) {
    return NextResponse.json({ error: "kind and id are required." }, { status: 400 });
  }
  if (!Array.isArray(body.splits)) {
    return NextResponse.json({ error: "splits must be an array." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const userId = guard.membership.userId;
  if (!(await ownsItem(supabase, kind, itemId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const incoming: Array<{
    basisPoints: number;
    email: string | null;
    name: string;
    username: string | null;
    profileId: string | null;
  }> = [];

  for (const raw of body.splits as IncomingSplit[]) {
    const basisPoints = Number(raw.basis_points);
    const name =
      typeof raw.payee_name === "string" ? raw.payee_name.trim() : "";
    const email =
      typeof raw.payee_email === "string" && raw.payee_email.trim()
        ? raw.payee_email.trim().toLowerCase()
        : null;
    const username =
      typeof raw.payee_username === "string" && raw.payee_username.trim()
        ? raw.payee_username.trim().replace(/^@/, "")
        : null;

    if (!name) {
      return NextResponse.json(
        { error: "Every collaborator needs a name." },
        { status: 400 },
      );
    }
    if (!email && !username) {
      return NextResponse.json(
        {
          error: `${name} needs a Melori username or an email so their share can be paid out.`,
        },
        { status: 400 },
      );
    }
    incoming.push({ basisPoints, email, name, username, profileId: null });
  }

  const validation = validateSplits(
    incoming.map((s) => ({ basisPoints: s.basisPoints, label: s.name })),
  );
  if (!validation.valid) {
    return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
  }

  // Resolve a Melori username to a profile id. That is what lets the webhook
  // find the collaborator's Connect account and transfer their share
  // automatically; an unmatched payee is still recorded, just as "owed".
  for (const split of incoming) {
    if (!split.username) continue;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", split.username)
      .maybeSingle();
    const matched = (profile as { id: string } | null)?.id ?? null;
    if (!matched) {
      return NextResponse.json(
        { error: `No Melori member found with the username @${split.username}.` },
        { status: 400 },
      );
    }
    split.profileId = matched;
  }

  const column = splitTargetColumn(kind);
  const value = kind === "release" || kind === "track" ? Number(itemId) : itemId;

  const { error: delErr } = await supabase
    .from("revenue_splits")
    .delete()
    .eq(column, value as never);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  if (incoming.length > 0) {
    const { error: insErr } = await supabase.from("revenue_splits").insert(
      incoming.map((s) => ({
        owner_id: userId,
        [column]: value,
        payee_profile_id: s.profileId,
        payee_email: s.email,
        payee_name: s.name,
        basis_points: s.basisPoints,
      })),
    );
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    ownerBasisPoints: validation.ownerBps,
  });
}
