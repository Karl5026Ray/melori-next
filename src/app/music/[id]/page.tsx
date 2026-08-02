import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import BuyButton from "@/components/BuyButton";
import { getArtistRefsByProfileId } from "@/lib/catalog";
import { formatPriceCents } from "@/lib/format";
import StudioTrackPlayButton from "./StudioTrackPlayButton";

export const dynamic = "force-dynamic";

// Public detail page for a studio_tracks row. This closes the loop for the
// "View" button in the Studio TrackList (which links to /music/<track.id>),
// so an artist can visit their own uploaded track exactly as a fan would.
//
// Design choice: keep this route Studio-only. Legacy `releases` use the
// `[slug]` route, and a slug never looks like a UUID, so there is no
// collision. If a caller lands here with a non-UUID id, the DB filter simply
// returns no row and we render notFound() — the URL pattern stays clean.
interface StudioTrackDetail {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  cover_url: string | null;
  preview_url: string | null;
  duration: number | null;
  price_cents: number | null;
  status: string;
  created_at: string;
  profile_id: string | null;
  profile: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

async function getPublishedStudioTrack(
  id: string,
): Promise<StudioTrackDetail | null> {
  // UUIDs only. `.eq("id", …)` with a non-UUID value would raise a Postgres
  // error rather than returning empty; guard upfront so a slug-shaped URL
  // just 404s cleanly.
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(id)) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_tracks")
    .select(
      "id, title, artist, album, genre, cover_url, preview_url, duration, price_cents, status, created_at, profile_id, profile:profiles!studio_tracks_profile_id_fkey(display_name, avatar_url)",
    )
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();

  if (error || !data) return null;

  // Supabase returns embeds as either an object or a single-item array
  // depending on relationship shape; normalize to a single object.
  const raw = data as unknown as StudioTrackDetail & {
    profile: StudioTrackDetail["profile"] | StudioTrackDetail["profile"][];
  };
  const profile = Array.isArray(raw.profile) ? raw.profile[0] ?? null : raw.profile;
  return { ...(raw as StudioTrackDetail), profile };
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default async function StudioTrackPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const track = await getPublishedStudioTrack(params.id);
  if (!track) notFound();

  const displayArtist = track.profile?.display_name?.trim() || track.artist;
  const duration = formatDuration(track.duration);

  // Resolve the uploader to their public artist page so their name is a link
  // here just like it is on every card.
  const artistRefs = track.profile_id
    ? await getArtistRefsByProfileId([track.profile_id]).catch(() => new Map())
    : new Map();
  const artistRef = track.profile_id ? artistRefs.get(track.profile_id) : null;
  const priceCents = track.price_cents;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/music"
        className="text-sm text-text-secondary hover:text-[#c9a96e]"
      >
        ← Back to Music
      </Link>
      <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
        {track.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          (<img
            src={track.cover_url}
            alt={`${track.title} cover art`}
            className="h-48 w-48 flex-shrink-0 rounded-2xl object-cover shadow-lg"
          />)
        ) : (
          <div className="flex h-48 w-48 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#c9a96e]/20 to-[#a08050]/20 text-6xl">
            🎵
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-text-secondary">
            {track.genre ?? "Single"}
          </p>
          <h1 className="mt-1 text-3xl font-bold sm:text-4xl">{track.title}</h1>
          {artistRef ? (
            <Link
              href={`/artists/${artistRef.slug}`}
              className="mt-2 inline-block text-lg text-text-secondary transition-colors hover:text-[#c9a96e] hover:underline"
            >
              {artistRef.name || displayArtist}
            </Link>
          ) : (
            <p className="mt-2 text-lg text-text-secondary">{displayArtist}</p>
          )}
          {track.album && (
            <p className="mt-1 text-sm text-text-secondary/80">
              From {track.album}
            </p>
          )}
          {duration && (
            <p className="mt-1 text-sm text-text-secondary/80">{duration}</p>
          )}
          <p className="mt-2 text-sm font-medium text-[#c9a96e]">
            {formatPriceCents(priceCents)}
          </p>

          {/* Route playback through PlayerProvider so listens get logged and
              superfan gating works. The old bare <audio> element skipped both. */}
          <StudioTrackPlayButton
            track={{
              id: track.id,
              title: track.title,
              displayArtist,
              coverUrl: track.cover_url,
            }}
          />

          {priceCents != null && priceCents > 0 && (
            <BuyButton
              title={track.title}
              priceCents={priceCents}
              studioTrackId={track.id}
            />
          )}
        </div>
      </div>
    </div>
  );
}
