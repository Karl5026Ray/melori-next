import Link from "next/link";
import type { StudioTrackListItem } from "@/lib/data";

// Public-site presentation of studio_tracks (artist self-uploads).
//
// This is intentionally a small, self-contained Server Component: it doesn't
// share MusicCatalog's filter/search state because the two lists have
// different shapes (studio_tracks are flat singles, releases can be albums
// with track counts). If the two schemas ever converge, this can fold into
// MusicCatalog — until then, keeping them separate avoids the "everything's
// an album" mismatch that would show up as a broken album view.
export default function StudioTrackGrid({
  tracks,
}: {
  tracks: StudioTrackListItem[];
}) {
  if (tracks.length === 0) return null;

  return (
    <section className="mt-16">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Latest from Artists</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Fresh uploads straight from the MELORI Artist Studio.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {tracks.map((track) => {
          // Prefer the profile display name (canonical, editable) over the
          // free-text `artist` field the artist typed at upload — the latter
          // is often the account holder's legal name.
          const displayArtist =
            track.profile?.display_name?.trim() || track.artist;
          return (
            <Link
              key={track.id}
              href={`/music/${track.id}`}
              className="group flex gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-[#c9a96e]/30"
            >
              {track.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.cover_url}
                  alt={`${track.title} cover art`}
                  className="h-20 w-20 flex-shrink-0 rounded-xl object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#c9a96e]/20 to-[#a08050]/20 text-2xl">
                  🎵
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold group-hover:text-[#c9a96e]">
                  {track.title}
                </h3>
                <p className="mt-0.5 truncate text-sm text-text-secondary">
                  {displayArtist}
                  {track.album ? ` · ${track.album}` : ""}
                </p>
                <p className="mt-1 text-xs text-text-secondary/70">
                  {track.genre ?? "Single"}
                  {track.preview_url ? " · Preview available" : ""}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
