import Link from "next/link";
import CoverImage from "@/components/CoverImage";
import PlayCount from "@/components/PlayCount";
import { formatPrice } from "@/lib/format";
import type { ReleaseListItem } from "@/lib/data";

export default function ReleaseCard({ release }: { release: ReleaseListItem }) {
  return (
    <Link
      href={`/albums/${release.slug}`}
      className="group flex flex-col rounded-lg border border-brand-border bg-brand-surface p-3 transition-colors hover:border-brand-primary"
    >
      <CoverImage
        src={release.cover_art_url}
        alt={release.title}
        className="aspect-square w-full"
      />
      <div className="mt-3 flex flex-col gap-1">
        <p className="truncate font-semibold text-text-primary group-hover:text-brand-primary">
          {release.title}
        </p>
        {release.artist && (
          <p className="truncate text-sm text-text-secondary">
            {release.artist.name}
          </p>
        )}
        {/* Plays join the existing stats line rather than taking a row of their
            own, so the card keeps its height when a release's first play lands
            mid-listen. */}
        <div className="mt-1 flex items-center justify-between gap-2 text-xs">
          <span className="truncate uppercase tracking-wide text-text-secondary">
            {release.release_type}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <PlayCount baseline={release.trackPlayCounts ?? {}} />
            <span className="font-medium text-brand-primary">
              {formatPrice(release.price)}
            </span>
          </span>
        </div>
        {/* Every release streams free (30s previews for everyone); the price is
            only to own/download. Make the free-listen path obvious on the card. */}
        <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-brand-primary/10 px-2 py-0.5 text-[11px] font-medium text-brand-primary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M8 5v14l11-7z" />
          </svg>
          Free to stream
        </span>
      </div>
    </Link>
  );
}
