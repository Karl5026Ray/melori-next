import type { Metadata } from "next";
import BookCover from "@/components/books/BookCover";
import { BOOK_SERIES, bookUrlFor, coverUrlFor, type Book, type BookSeries } from "@/lib/books";

const description =
  "The Melori Band picture books, the Without The Blacks history series, the Say It Out Loud teen series, Right Before My Song, Denny: Never Give Up, Hikari Discovers, and WOE.";

export const metadata: Metadata = {
  title: "Books",
  description,
  openGraph: { title: "Books", description, images: ["/images/og-image.png"] },
};

// Hourly ISR so the seasonal note drops off on its date without a deploy.
export const revalidate = 3600;

const isLive = (b: Book) => b.live !== false && !!bookUrlFor(b);

// Layout (Karl, 2026-10-03): no single-book hero. Pip alone at the top hid the
// rest of the catalog — "people need to see that there is more than what they
// first see." Shelves start right under the heading, three covers across on a
// phone, so the first screen already shows several books. Every cover is the
// same 2:3 size (see BookCover).
//
// The cover is the link (Karl: "if we just place the link with the cover people
// will tap it"). No "Get it on Amazon" button; the page does not advertise the
// store. The accessible name still says where it goes.
function BookCard({ book, series }: { book: Book; series: BookSeries }) {
  const live = isLive(book);
  const href = bookUrlFor(book);
  const inner = (
    <>
      <div className="transition-transform duration-200 group-hover:-translate-y-1 group-active:scale-[0.98]">
        <BookCover
          title={book.title}
          seriesId={series.id}
          seriesName={series.name}
          src={coverUrlFor(book)}
        />
      </div>
      {book.badge && (
        <span className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-brand-primary sm:text-xs">
          {book.badge}
          {!live && " · Soon"}
        </span>
      )}
      <span className="mt-0.5 block text-xs font-semibold leading-snug transition-colors group-hover:text-brand-primary sm:text-sm">
        {book.title}
      </span>
      {/* The blurbs were in the data all along and never shown (review,
          16 Nov 2026). Two lines max so the shelf stays a shelf. */}
      {book.blurb && (
        <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-text-secondary sm:text-xs">
          {book.blurb}
        </span>
      )}
    </>
  );
  if (!live || !href) return <div className="opacity-60">{inner}</div>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${book.title} (opens the book's store page)`}
      className="group block"
    >
      {inner}
    </a>
  );
}

// One book on its own, with room to say what it is. Used on the shared shelf
// below: before 16 Nov 2026 those titles (Denny, WOE, Was It Just Business?,
// Right Before My Song) showed a bare cover with no pitch at all.
function StandaloneCard({ book, series }: { book: Book; series: BookSeries }) {
  const live = isLive(book);
  const href = bookUrlFor(book);
  const cover = (
    <div className="w-24 shrink-0 sm:w-28">
      <BookCover title={book.title} seriesId={series.id} seriesName={series.name} src={coverUrlFor(book)} />
    </div>
  );
  return (
    <div className={`flex gap-4 rounded-2xl border border-brand-border p-3 sm:p-4 ${live ? "" : "opacity-60"}`}>
      {live && href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${book.title} (opens the book's store page)`} className="transition-transform hover:-translate-y-0.5">
          {cover}
        </a>
      ) : (
        cover
      )}
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary sm:text-xs">{series.audience}</p>
        <h3 className="mt-0.5 text-base font-bold leading-snug sm:text-lg">
          {live && href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-brand-primary">
              {book.title}
            </a>
          ) : (
            book.title
          )}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{series.description}</p>
      </div>
    </div>
  );
}

type Shelf = {
  id: string;
  name: string;
  audience?: string;
  description?: string;
  listen?: BookSeries["listen"];
  seasonal?: BookSeries["seasonal"];
  standalone?: boolean;
  items: { book: Book; series: BookSeries }[];
};

// Several one-book series would each get a near-empty shelf, so they share one.
const SHELVES: Shelf[] = [
  ...BOOK_SERIES.filter((s) => s.books.length > 1).map((s) => ({
    id: s.id,
    name: s.name,
    audience: s.audience,
    description: s.description,
    listen: s.listen,
    seasonal: s.seasonal,
    items: s.books.map((book) => ({ book, series: s })),
  })),
  {
    id: "more",
    name: "More Titles",
    standalone: true,
    items: BOOK_SERIES.filter((s) => s.books.length === 1).flatMap((s) =>
      s.books.map((book) => ({ book, series: s })),
    ),
  },
];

const liveCount = BOOK_SERIES.flatMap((s) => s.books).filter(isLive).length;

export default function BooksPage() {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-bold md:text-4xl">Books</h1>
      <p className="mt-2 max-w-2xl text-text-secondary">
        {liveCount} books and counting: picture books from The Melori Band,
        history, teen stories, and more. Tap any cover to get the book.
      </p>

      <nav aria-label="Shelves" className="mt-5 flex flex-wrap gap-2">
        {SHELVES.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-brand-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-brand-primary"
          >
            {s.name}
          </a>
        ))}
      </nav>

      {SHELVES.map((shelf, i) => {
        const out = shelf.items.filter((x) => isLive(x.book));
        const next = shelf.items.filter((x) => !isLive(x.book));
        return (
          <section
            key={shelf.id}
            id={shelf.id}
            className={`scroll-mt-24 ${i === 0 ? "mt-8" : "mt-12 border-t border-brand-border pt-8"}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-xl font-bold sm:text-2xl">{shelf.name}</h2>
              {shelf.audience && (
                <span className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  {shelf.audience}
                </span>
              )}
              {next.length > 0 && (
                <span className="text-sm text-text-secondary">
                  {out.length} of {shelf.items.length} out now
                </span>
              )}
            </div>
            {shelf.description && (
              <p className="mt-1 max-w-2xl text-sm text-text-secondary">{shelf.description}</p>
            )}
            {shelf.seasonal && today < shelf.seasonal.until && (
              <p className="mt-3 inline-block rounded-full bg-brand-primary/15 px-3 py-1.5 text-sm font-semibold text-brand-primary" data-testid="books-seasonal">
                {shelf.seasonal.line}
              </p>
            )}
            {shelf.listen && (
              <p className="mt-3 max-w-2xl text-sm">
                <a href={shelf.listen.href} className="font-medium text-brand-primary hover:underline" data-testid="books-listen">
                  {shelf.listen.line} &rarr;
                </a>
              </p>
            )}
            {shelf.standalone ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {[...out, ...next].map(({ book, series }) => (
                  <StandaloneCard key={book.title} book={book} series={series} />
                ))}
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 lg:grid-cols-6">
                {[...out, ...next].map(({ book, series }) => (
                  <BookCard key={book.title} book={book} series={series} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
