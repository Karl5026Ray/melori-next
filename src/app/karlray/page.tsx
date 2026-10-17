import type { Metadata } from "next";
import { BOOK_SERIES, coverUrlFor } from "@/lib/books";

// Karl's link-in-bio page (2026-10-17).
//
// Social bios allow ONE link. It used to be the Amazon author page, which left
// his music with no way in. Every bio now points here instead, and this page
// splits the visitor between his books and his own music (RELAUNCH).
//
// Public on purpose: it is in PUBLIC_EXACT in src/proxy.ts. A bio link that
// lands on the signup door loses the visitor.
//
// The music link is the US Amazon Music storefront. Karl's share link came
// from the .com.au store; same album id, but US fans would land in the
// Australian catalog.

const BOOKS_URL = "https://www.amazon.com/author/karlraybooks";
const RELAUNCH_URL = "https://music.amazon.com/albums/B0HKNBB2PQ";

const description =
  "Karl Ray: author, musician and photographer from Chicago. Books for kids, teens and adults, and RELAUNCH, his album.";

export const metadata: Metadata = {
  title: "Karl Ray",
  description,
  openGraph: { title: "Karl Ray", description, images: ["/images/og-image.png"] },
};

// One cover from each series, so the first screen shows the range.
const PREVIEW = BOOK_SERIES.map((s) => s.books[0]!)
  .filter((b) => coverUrlFor(b))
  .slice(0, 6);

function LinkButton({
  href,
  title,
  sub,
  primary = false,
  external = true,
}: {
  href: string;
  title: string;
  sub: string;
  primary?: boolean;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`block w-full rounded-2xl px-5 py-4 text-center transition-transform active:scale-[0.98] ${
        primary
          ? "bg-brand-primary text-white hover:bg-brand-primary-dark"
          : "border border-brand-border bg-brand-surface hover:border-brand-primary"
      }`}
    >
      <span className="block text-lg font-bold">{title}</span>
      <span className={`block text-sm ${primary ? "text-white/85" : "text-text-secondary"}`}>{sub}</span>
    </a>
  );
}

export default function KarlRayLinksPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-center text-3xl font-bold">Karl Ray</h1>
      <p className="mt-2 text-center text-text-secondary">
        Author · Musician · Photographer · Chicago
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2">
        {PREVIEW.map((b) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={b.title}
            src={coverUrlFor(b)!}
            alt={b.title}
            className="aspect-[2/3] w-full rounded-md object-cover"
            loading="lazy"
          />
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <LinkButton
          href={BOOKS_URL}
          title="Get the Books"
          sub="The Melori Band, Without The Blacks, Denny and more"
          primary
        />
        <LinkButton href={RELAUNCH_URL} title="Listen to RELAUNCH" sub="Karl Ray's album" />
        <LinkButton href="/books" title="Browse every book" sub="All series, by age" external={false} />
        <LinkButton href="/gallery" title="Photography" sub="Karl Ray Photography" external={false} />
      </div>
    </div>
  );
}
