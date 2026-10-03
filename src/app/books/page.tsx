import type { Metadata } from "next";
import BookCover from "@/components/books/BookCover";
import {
  AUTHOR_PAGE_URL,
  BOOK_SERIES,
  buyUrlFor,
  coverUrlFor,
  type Book,
  type BookSeries,
} from "@/lib/books";

const description =
  "The Melori Band picture books, the Without The Blacks history series, the Say It Out Loud teen series, and Hikari Discovers activity books.";

export const metadata: Metadata = {
  title: "Books",
  description,
  openGraph: { title: "Books", description, images: ["/images/og-image.png"] },
};

const isLive = (b: Book) => b.live !== false;

function Cover({
  book,
  series,
  size = "md",
}: {
  book: Book;
  series: BookSeries;
  size?: "md" | "lg";
}) {
  return (
    <BookCover
      title={book.title}
      seriesId={series.id}
      seriesName={series.name}
      src={coverUrlFor(book)}
      large={size === "lg"}
    />
  );
}

function AmazonButton({ book, series }: { book: Book; series: BookSeries }) {
  return (
    <a
      href={buyUrlFor(book, series.name)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-dark"
    >
      Get it on Amazon
    </a>
  );
}

function BookCard({ book, series }: { book: Book; series: BookSeries }) {
  const live = isLive(book);
  return (
    <article className={`flex flex-col ${live ? "" : "opacity-60"}`}>
      <Cover book={book} series={series} />
      {book.badge && (
        <span className="mt-3 text-xs font-semibold uppercase tracking-wide text-brand-primary">
          {book.badge}
        </span>
      )}
      <h3 className="mt-1 font-bold leading-snug">{book.title}</h3>
      {book.blurb && <p className="mt-1 text-sm text-text-secondary">{book.blurb}</p>}
      <div className="mt-auto pt-3">
        {live ? (
          <AmazonButton book={book} series={series} />
        ) : (
          <span className="inline-block rounded-full border border-brand-border px-4 py-2 text-sm text-text-secondary">
            Coming soon
          </span>
        )}
      </div>
    </article>
  );
}

export default function BooksPage() {
  // The hero is the first book of the first series: the front door to the
  // whole Melori Band run, so a new reader starts where the story starts.
  const heroSeries = BOOK_SERIES[0];
  const hero = heroSeries.books[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold md:text-4xl">Books</h1>
      <p className="mt-3 max-w-2xl text-text-secondary">
        Picture books from The Melori Band, history, teen stories and more.
        Each book links straight to Amazon.
      </p>

      {/* Hero: start the series here */}
      <section className="relative mt-10 overflow-hidden rounded-2xl border border-brand-border">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="grid items-center gap-8 p-6 sm:grid-cols-[minmax(0,220px)_1fr] sm:p-10">
          <div className="mx-auto w-44 sm:w-full">
            <Cover book={hero} series={heroSeries} size="lg" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-primary">
              Start here · {heroSeries.name} {hero.badge}
            </p>
            <h2 className="mt-2 text-2xl font-bold md:text-3xl">{hero.title}</h2>
            {hero.blurb && (
              <p className="mt-3 max-w-xl text-text-secondary">{hero.blurb}</p>
            )}
            <p className="mt-3 max-w-xl text-sm text-text-secondary">
              {heroSeries.description}
            </p>
            <div className="mt-5">
              <AmazonButton book={hero} series={heroSeries} />
            </div>
          </div>
        </div>
      </section>

      <nav aria-label="Series" className="mt-10 flex flex-wrap gap-2">
        {BOOK_SERIES.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-brand-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-brand-primary"
          >
            {s.name}
          </a>
        ))}
      </nav>

      {BOOK_SERIES.map((series) => {
        const out = series.books.filter(isLive);
        const next = series.books.filter((b) => !isLive(b));
        return (
          <section
            key={series.id}
            id={series.id}
            className="mt-14 scroll-mt-24 border-t border-brand-border pt-10"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
              {series.audience}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-2xl font-bold">{series.name}</h2>
              {next.length > 0 && (
                <span className="text-sm text-text-secondary">
                  {out.length} of {series.books.length} out now
                </span>
              )}
            </div>
            <p className="mt-2 max-w-2xl text-text-secondary">{series.description}</p>

            <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
              {out.map((book) => (
                <BookCard key={book.title} book={book} series={series} />
              ))}
            </div>

            {next.length > 0 && (
              <>
                <h3 className="mt-12 text-lg font-bold">Coming next</h3>
                <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
                  {next.map((book) => (
                    <BookCard key={book.title} book={book} series={series} />
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })}

      <div className="mt-16 border-t border-brand-border pt-8 text-center">
        <a
          href={AUTHOR_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-text-secondary transition-colors hover:text-brand-primary"
        >
          See every book on Amazon →
        </a>
      </div>
    </div>
  );
}
