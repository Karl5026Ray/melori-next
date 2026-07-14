import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRadioPool, type RadioTrack } from "@/lib/data";

// Server-side data access for member-curated saved playlists (Radio Phase 2).
// Reuses the same service-role admin client as the rest of data.ts, so never
// import this into a client component.
//
// A playlist item points at exactly one track surface (studio_track_id OR
// legacy_track_id), matching the saved_playlist_tracks CHECK. We resolve those
// ids back to full RadioTrack objects via getRadioPool() so the player gets
// the same cover/artist/duration shape it already understands — and so
// unpublished/removed tracks silently drop out of a saved playlist.

export interface SavedPlaylist {
  id: string;
  name: string;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistTrackRef {
  sourceType: "legacy" | "studio";
  id: number | string;
}

// Build a stable string key for a RadioTrack so client + server agree on
// identity across the legacy/studio split. Format: "studio:<uuid>" / "legacy:<int>".
export function trackKey(sourceType: "legacy" | "studio", id: number | string): string {
  return `${sourceType}:${id}`;
}

// List the caller's playlists (most-recently-updated first) with track counts.
export async function listPlaylists(ownerId: string): Promise<SavedPlaylist[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("saved_playlists")
    .select(
      "id, name, created_at, updated_at, saved_playlist_tracks(count)",
    )
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("listPlaylists error", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => {
    const countRel = row.saved_playlist_tracks;
    const trackCount = Array.isArray(countRel)
      ? (countRel[0]?.count ?? 0)
      : (countRel?.count ?? 0);
    return {
      id: row.id as string,
      name: row.name as string,
      trackCount: Number(trackCount) || 0,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  });
}

export async function createPlaylist(
  ownerId: string,
  name: string,
): Promise<SavedPlaylist | null> {
  const supabase = getSupabaseAdmin();
  const clean = name.trim().slice(0, 80) || "My Playlist";
  const { data, error } = await supabase
    .from("saved_playlists")
    .insert({ owner_id: ownerId, name: clean })
    .select("id, name, created_at, updated_at")
    .single();

  if (error || !data) {
    console.error("createPlaylist error", error?.message);
    return null;
  }
  return {
    id: data.id as string,
    name: data.name as string,
    trackCount: 0,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

// Rename or delete are owner-scoped (we always filter by owner_id as a second
// guard on top of RLS, since the admin client bypasses RLS).
export async function renamePlaylist(
  ownerId: string,
  playlistId: string,
  name: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const clean = name.trim().slice(0, 80);
  if (!clean) return false;
  const { error } = await supabase
    .from("saved_playlists")
    .update({ name: clean, updated_at: new Date().toISOString() })
    .eq("id", playlistId)
    .eq("owner_id", ownerId);
  if (error) console.error("renamePlaylist error", error.message);
  return !error;
}

export async function deletePlaylist(
  ownerId: string,
  playlistId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("saved_playlists")
    .delete()
    .eq("id", playlistId)
    .eq("owner_id", ownerId);
  if (error) console.error("deletePlaylist error", error.message);
  return !error;
}

// Confirm a playlist belongs to the caller (used before mutating tracks).
async function ownsPlaylist(
  ownerId: string,
  playlistId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("saved_playlists")
    .select("id")
    .eq("id", playlistId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return Boolean(data);
}

export async function addTrackToPlaylist(
  ownerId: string,
  playlistId: string,
  ref: PlaylistTrackRef,
): Promise<boolean> {
  if (!(await ownsPlaylist(ownerId, playlistId))) return false;
  const supabase = getSupabaseAdmin();

  // Append to the end: next position = current max + 1.
  const { data: last } = await supabase
    .from("saved_playlist_tracks")
    .select("position")
    .eq("playlist_id", playlistId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPos = ((last?.position as number) ?? -1) + 1;

  const row: Record<string, unknown> =
    ref.sourceType === "studio"
      ? { playlist_id: playlistId, studio_track_id: String(ref.id), position: nextPos }
      : { playlist_id: playlistId, legacy_track_id: Number(ref.id), position: nextPos };

  // upsert-on-conflict: adding a track already in the playlist is a no-op, not
  // an error (the partial unique indexes guarantee dedupe).
  const { error } = await supabase
    .from("saved_playlist_tracks")
    .upsert(row, {
      onConflict:
        ref.sourceType === "studio"
          ? "playlist_id,studio_track_id"
          : "playlist_id,legacy_track_id",
      ignoreDuplicates: true,
    });
  if (error) console.error("addTrackToPlaylist error", error.message);
  return !error;
}

export async function removeTrackFromPlaylist(
  ownerId: string,
  playlistId: string,
  ref: PlaylistTrackRef,
): Promise<boolean> {
  if (!(await ownsPlaylist(ownerId, playlistId))) return false;
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("saved_playlist_tracks")
    .delete()
    .eq("playlist_id", playlistId);
  q =
    ref.sourceType === "studio"
      ? q.eq("studio_track_id", String(ref.id))
      : q.eq("legacy_track_id", Number(ref.id));
  const { error } = await q;
  if (error) console.error("removeTrackFromPlaylist error", error.message);
  return !error;
}

// Resolve a playlist's stored track refs to full RadioTrack objects, in the
// listener's saved order. Tracks that no longer exist / were unpublished drop
// out (they won't be in the radio pool).
export async function getPlaylistTracks(
  ownerId: string,
  playlistId: string,
): Promise<{ name: string; tracks: RadioTrack[] } | null> {
  if (!(await ownsPlaylist(ownerId, playlistId))) return null;
  const supabase = getSupabaseAdmin();

  const [{ data: meta }, { data: rows }, pool] = await Promise.all([
    supabase
      .from("saved_playlists")
      .select("name")
      .eq("id", playlistId)
      .maybeSingle(),
    supabase
      .from("saved_playlist_tracks")
      .select("studio_track_id, legacy_track_id, position, added_at")
      .eq("playlist_id", playlistId)
      .order("position", { ascending: true })
      .order("added_at", { ascending: true }),
    getRadioPool(),
  ]);

  // Index the pool by key for O(1) lookup.
  const byKey = new Map<string, RadioTrack>();
  for (const t of pool) byKey.set(trackKey(t.sourceType, t.id), t);

  const tracks: RadioTrack[] = [];
  for (const r of (rows ?? []) as any[]) {
    const key =
      r.studio_track_id != null
        ? trackKey("studio", r.studio_track_id)
        : trackKey("legacy", r.legacy_track_id);
    const t = byKey.get(key);
    if (t) tracks.push(t);
  }

  return { name: (meta?.name as string) ?? "Playlist", tracks };
}

// Which of the caller's playlists already contain a given track — powers the
// checkmarks in the "add to playlist" sheet.
export async function playlistsContainingTrack(
  ownerId: string,
  ref: PlaylistTrackRef,
): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data: mine } = await supabase
    .from("saved_playlists")
    .select("id")
    .eq("owner_id", ownerId);
  const ids = (mine ?? []).map((r: any) => r.id as string);
  if (ids.length === 0) return [];

  let q = supabase
    .from("saved_playlist_tracks")
    .select("playlist_id")
    .in("playlist_id", ids);
  q =
    ref.sourceType === "studio"
      ? q.eq("studio_track_id", String(ref.id))
      : q.eq("legacy_track_id", Number(ref.id));
  const { data } = await q;
  return (data ?? []).map((r: any) => r.playlist_id as string);
}
