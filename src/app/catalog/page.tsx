import type { Metadata } from "next";
import { ARTIST_PAGE_URL, SONG_GROUPS, type Song } from "@/lib/songs";

const total = SONG_GROUPS.reduce((n, g) => n + g.songs.length, 0);

const description =
  "Every release from Karl Ray, KAIEL R, Gloria Joy Rivers and The Melori Band, with links to listen on your favorite streaming service.";

export const metadata: Metadata = {
  title: "Song Catalog",
  description,
  openGraph: { title: "Song Catalog", description, images: ["/images/og-image.png"] },
};

// Layout follows /books: a heading, jump links to each group, then the groups.
// Each title is the link (no separate "Listen" buttons), opening the song's
// HyperFollow page where the listener picks Spotify, Apple Music and the rest.
function SongRow({ song, index }: { song: Song; index: number }) {
  return (
    <li className="border-t border-brand-border first:border-t-0">
      <a
        href={song.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${song.title} (opens the song's listening page)`}
        className="group flex items-baseline gap-3 px-4 py-3 transition-colors hover:bg-white/5"
      >
        <span className="w-6 shrink-0 text-xs tabular-nums text-text-secondary">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1 font-semibold leading-snug transition-colors group-hover:text-brand-primary">
          {song.title}
        </span>
        <span aria-hidden="true" className="text-text-secondary transition-colors group-hover:text-brand-primary">
          ↗
        </span>
      </a>
    </li>
  );
}

export default function CatalogPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-bold md:text-4xl">Song Catalog</h1>
      <p className="mt-2 max-w-2xl text-text-secondary">
        {total} songs from Karl Ray, KAIEL R, Gloria Joy Rivers and The Melori
        Band. Tap any title to listen on your favorite streaming service.
      </p>

      <nav aria-label="Artists" className="mt-5 flex flex-wrap gap-2">
        {SONG_GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="rounded-full border border-brand-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-brand-primary"
          >
            {g.name}
          </a>
        ))}
      </nav>

      {SONG_GROUPS.map((group, i) => (
        <section
          key={group.id}
          id={group.id}
          className={`scroll-mt-24 ${i === 0 ? "mt-8" : "mt-12 border-t border-brand-border pt-8"}`}
        >
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-xl font-bold sm:text-2xl">{group.name}</h2>
            <span className="text-sm text-text-secondary">
              {group.songs.length} {group.songs.length === 1 ? "song" : "songs"}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">{group.description}</p>
          <ol className="mt-4 overflow-hidden rounded-xl border border-brand-border">
            {group.songs.map((song, idx) => (
              <SongRow key={song.url} song={song} index={idx} />
            ))}
          </ol>
        </section>
      ))}

      <p className="mt-12 border-t border-brand-border pt-6 text-sm text-text-secondary">
        Follow Karl Ray to hear new releases first:{" "}
        <a
          href={ARTIST_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-brand-primary hover:underline"
        >
          Karl Ray artist page
        </a>
      </p>
    </div>
  );
}
