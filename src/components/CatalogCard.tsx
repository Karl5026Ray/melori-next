import Link from "next/link";
import CoverImage from "@/components/CoverImage";
import PlayCount from "@/components/PlayCount";
import BuyButton from "@/components/BuyButton";
import { formatPriceCents } from "@/lib/format";
import type { CatalogItem } from "@/lib/catalog";

// One card for every kind of catalog item — legacy releases and artist
// self-uploads alike. Replaces ReleaseCard, which could only render the
// former.
//
// Structural note: the cover and title link to the item, but the ARTIST name
// is a SIBLING link, not a nested one. Nesting an <a> inside an <a> is invalid
// HTML and browsers silently drop the inner one, which is exactly how "artist
// names aren't clickable" would come back. The card is a plain container and
// each link stands on its own.
export default function CatalogCard({ item }: { item: CatalogItem }) {
  const isFree = item.priceCents === 0;
  const canBuy = item.checkout != null && (item.priceCents ?? 0) > 0;
  const artistHref = item.artist?.slug ? `/artists/${item.artist.slug}` : null;

  return (
    <div className="group flex flex-col rounded-lg border border-brand-border bg-brand-surface p-3 transition-colors hover:border-brand-primary">
      <Link href={item.href} className="block" aria-label={item.title}>
        <CoverImage
          src={item.cover_art_url}
          alt={item.title}
          className="aspect-square w-full"
        />
      </Link>
      <div className="mt-3 flex flex-col gap-1">
        <Link href={item.href} className="min-w-0">
          <p className="truncate font-semibold text-text-primary group-hover:text-brand-primary">
            {item.title}
          </p>
        </Link>

        {item.artist &&
          (artistHref ? (
            <Link
              href={artistHref}
              className="truncate text-sm text-text-secondary transition-colors hover:text-brand-primary hover:underline"
            >
              {item.artist.name}
            </Link>
          ) : (
            <p className="truncate text-sm text-text-secondary">
              {item.artist.name}
            </p>
          ))}

        <div className="mt-1 flex items-center justify-between gap-2 text-xs">
          <span className="truncate uppercase tracking-wide text-text-secondary">
            {item.release_type}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {item.trackPlayCounts && (
              <PlayCount baseline={item.trackPlayCounts} />
            )}
            {/* data-native-hide: a price is a purchase affordance under App
                Store guideline 3.1.1, and this card renders on ISR-cached pages
                whose HTML is shared by web and app visitors alike — the server
                cannot know the platform, so the pre-paint CSS in native-app.css
                is what removes it inside the wrapper. See
                docs/ios-app-store-compliance.md. */}
            <span data-native-hide className="font-medium text-brand-primary">
              {formatPriceCents(item.priceCents)}
            </span>
          </span>
        </div>

        {/* Every item streams free (30s previews for everyone); the price is
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
          {isFree ? "Free download" : "Free 30-sec preview"}
        </span>

        {canBuy && (
          <div className="mt-2">
            <BuyButton
              variant="compact"
              title={item.title}
              priceCents={item.priceCents ?? 0}
              releaseId={item.checkout?.releaseId}
              studioTrackId={item.checkout?.studioTrackId}
              studioAlbumId={item.checkout?.studioAlbumId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
