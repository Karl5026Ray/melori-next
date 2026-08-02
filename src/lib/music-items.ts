import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only resolution of "what is being sold" for the music checkout and
// the webhook that fulfils it.
//
// The one rule this file exists to enforce: the PRICE IS READ FROM THE
// DATABASE, never from the request body. The browser only ever names an id.
// Both the checkout route and the webhook resolve through here, so the amount
// charged and the amount split can never disagree.

export type MusicItemKind = "release" | "track" | "studio_track" | "studio_album";

export interface ResolvedMusicItem {
  kind: MusicItemKind;
  /** String form of the id; callers cast back for the legacy integer tables. */
  id: string;
  name: string;
  amountCents: number;
  currency: string;
  /** Legacy `artists.id`, when the item belongs to one. */
  artistId: number | null;
  /** Owning member's `profiles.id`, when known — the splits/payout key. */
  ownerProfileId: string | null;
}

export interface MusicItemRequest {
  releaseId?: number | null;
  trackId?: number | null;
  studioTrackId?: string | null;
  studioAlbumId?: string | null;
}

// Prices on legacy `releases`/`tracks` are DECIMAL dollars.
function dollarsToCents(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface ResolveFailure {
  error: string;
}

export function isResolveFailure(
  result: ResolvedMusicItem | ResolveFailure,
): result is ResolveFailure {
  return (result as ResolveFailure).error !== undefined;
}

export async function resolveMusicItem(
  req: MusicItemRequest,
  supabase: SupabaseClient,
): Promise<ResolvedMusicItem | ResolveFailure> {
  if (req.studioAlbumId) {
    if (!isUuid(req.studioAlbumId)) return { error: "This album is not available." };
    const { data: album } = await supabase
      .from("studio_albums")
      .select("id, title, price_cents, currency, profile_id")
      .eq("id", req.studioAlbumId)
      .maybeSingle();
    if (!album) return { error: "This album is not available." };

    // An album with no published tracks isn't purchasable — there'd be
    // nothing to download.
    const { count } = await supabase
      .from("studio_tracks")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", (album as any).profile_id)
      .eq("album", (album as any).title)
      .eq("status", "published");
    if (!count) return { error: "This album is not available." };

    return {
      kind: "studio_album",
      id: (album as any).id,
      name: (album as any).title,
      amountCents: Number((album as any).price_cents ?? 0),
      currency: ((album as any).currency as string) || "usd",
      artistId: null,
      ownerProfileId: (album as any).profile_id ?? null,
    };
  }

  if (req.studioTrackId) {
    if (!isUuid(req.studioTrackId)) return { error: "This track is not available." };
    const { data: track } = await supabase
      .from("studio_tracks")
      .select("id, title, price_cents, currency, status, profile_id")
      .eq("id", req.studioTrackId)
      .maybeSingle();
    if (!track || (track as any).status !== "published") {
      return { error: "This track is not available." };
    }
    return {
      kind: "studio_track",
      id: (track as any).id,
      name: (track as any).title,
      amountCents: Number((track as any).price_cents ?? 0),
      currency: ((track as any).currency as string) || "usd",
      artistId: null,
      ownerProfileId: (track as any).profile_id ?? null,
    };
  }

  if (req.trackId != null) {
    const { data: track } = await supabase
      .from("tracks")
      .select(
        "id, title, price, is_published, release:releases(id, title, price, artist_id)",
      )
      .eq("id", req.trackId)
      .maybeSingle();
    const rel = (track as any)?.release ?? null;
    const release = Array.isArray(rel) ? rel[0] ?? null : rel;
    if (!track || (track as any).is_published === false || !release) {
      return { error: "This track is not available." };
    }
    // Track price overrides release price; NULL inherits the release price.
    const priceDollars =
      typeof (track as any).price === "number" && (track as any).price > 0
        ? (track as any).price
        : Number(release.price);
    const artistId = release.artist_id ?? null;
    return {
      kind: "track",
      id: String((track as any).id),
      name: (track as any).title,
      amountCents: dollarsToCents(priceDollars),
      currency: "usd",
      artistId,
      ownerProfileId: await lookupArtistProfileId(artistId, supabase),
    };
  }

  if (req.releaseId != null) {
    const { data: release } = await supabase
      .from("releases")
      .select("id, title, price, is_published, artist_id")
      .eq("id", req.releaseId)
      .maybeSingle();
    if (!release || (release as any).is_published === false) {
      return { error: "This release is not available." };
    }
    const artistId = (release as any).artist_id ?? null;
    return {
      kind: "release",
      id: String((release as any).id),
      name: (release as any).title,
      amountCents: dollarsToCents((release as any).price),
      currency: "usd",
      artistId,
      ownerProfileId: await lookupArtistProfileId(artistId, supabase),
    };
  }

  return { error: "Provide an item to purchase." };
}

async function lookupArtistProfileId(
  artistId: number | null,
  supabase: SupabaseClient,
): Promise<string | null> {
  if (!artistId) return null;
  const { data } = await supabase
    .from("artists")
    .select("profile_id")
    .eq("id", artistId)
    .maybeSingle();
  return ((data as any)?.profile_id as string | null) ?? null;
}

// Resolve a member's Connect account, but only when it can actually receive
// money. A half-onboarded account would make Stripe reject the transfer.
export async function getPayoutAccountForProfile(
  profileId: string | null,
  supabase: SupabaseClient,
): Promise<string | null> {
  if (!profileId) return null;
  const { data: artist } = await supabase
    .from("artists")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!(artist as any)?.id) return null;
  return getPayoutAccountForArtist((artist as any).id as number, supabase);
}

export async function getPayoutAccountForArtist(
  artistId: number | null,
  supabase: SupabaseClient,
): Promise<string | null> {
  if (!artistId) return null;
  const { data } = await supabase
    .from("artist_payouts")
    .select("stripe_connect_account_id, payouts_enabled")
    .eq("artist_id", artistId)
    .maybeSingle();
  const row = data as
    | { stripe_connect_account_id: string | null; payouts_enabled: boolean | null }
    | null;
  if (row?.stripe_connect_account_id && row.payouts_enabled) {
    return row.stripe_connect_account_id;
  }
  return null;
}

// The `revenue_splits` filter column for a given item kind. Splits attach to
// exactly one target (enforced by a CHECK constraint in migration 045).
export function splitTargetColumn(kind: MusicItemKind): string {
  switch (kind) {
    case "studio_track":
      return "studio_track_id";
    case "studio_album":
      return "studio_album_id";
    case "release":
      return "release_id";
    case "track":
      return "track_id";
  }
}

export interface CollaboratorSplit {
  id: string;
  basisPoints: number;
  payeeProfileId: string | null;
  payeeEmail: string | null;
  payeeName: string;
}

export async function getSplitsForItem(
  kind: MusicItemKind,
  itemId: string,
  supabase: SupabaseClient,
): Promise<CollaboratorSplit[]> {
  const column = splitTargetColumn(kind);
  const value =
    kind === "release" || kind === "track" ? Number(itemId) : itemId;

  const { data, error } = await supabase
    .from("revenue_splits")
    .select("id, basis_points, payee_profile_id, payee_email, payee_name")
    .eq(column, value as never)
    .order("created_at", { ascending: true });

  // A splits-table outage must never block a sale: fall through to the
  // single-payee path the platform used before splits existed.
  if (error || !data) return [];

  return (data as any[]).map((row) => ({
    id: row.id as string,
    basisPoints: Number(row.basis_points),
    payeeProfileId: (row.payee_profile_id as string | null) ?? null,
    payeeEmail: (row.payee_email as string | null) ?? null,
    payeeName: (row.payee_name as string) ?? "Collaborator",
  }));
}
