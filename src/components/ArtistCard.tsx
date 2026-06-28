import Link from "next/link";
import CoverImage from "@/components/CoverImage";
import type { Artist } from "@/types";

export default function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link
      href={`/artists/${artist.slug}`}
      className="group flex flex-col items-center rounded-lg border border-brand-border bg-brand-surface p-4 text-center transition-colors hover:border-brand-primary"
    >
      <CoverImage
        src={artist.avatar_url}
        alt={artist.name}
        className="h-28 w-28"
        rounded="rounded-full"
      />
      <p className="mt-3 flex items-center gap-1 font-semibold text-text-primary group-hover:text-brand-primary">
        <span className="truncate">{artist.name}</span>
        {artist.is_verified && (
          <span className="text-brand-primary" aria-label="Verified" title="Verified">
            ✓
          </span>
        )}
      </p>
    </Link>
  );
}
