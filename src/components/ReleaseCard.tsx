import Link from "next/link";
import CoverImage from "@/components/CoverImage";
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
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="uppercase tracking-wide text-text-secondary">
            {release.release_type}
          </span>
          <span className="font-medium text-brand-primary">
            {formatPrice(release.price)}
          </span>
        </div>
      </div>
    </Link>
  );
}
