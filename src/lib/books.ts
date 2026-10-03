// Karl Ray's books, shown on /books.
//
// Melori sells nothing (see /mission), so this page never takes money. Every
// "Get it on Amazon" button links out to Amazon, and Amazon handles the sale.
//
// HOW TO ADD OR FIX A BOOK
//   • Paste the book's Amazon link into `amazonUrl` (a /dp/ link from the
//     KDP Bookshelf). The cover is taken from the ASIN in that link.
//   • Until a book has its own link, its button runs an Amazon search for the
//     title, so the button always lands somewhere useful.
//   • Set `live: false` for a book that isn't on Amazon yet. It shows as
//     "Coming soon" with no button.

export const AUTHOR_PAGE_URL = "https://www.amazon.com/author/karlraybooks";

export type Book = {
  title: string;
  /** e.g. "Book 1" — shown as a small badge. */
  badge?: string;
  blurb?: string;
  /** A direct Amazon product link (https://www.amazon.com/dp/ASIN). */
  amazonUrl?: string;
  live?: boolean;
};

export type BookSeries = {
  id: string;
  name: string;
  audience: string;
  description: string;
  books: Book[];
};

// Order is Karl's (2026-10-02): The Melori Band is Melori's own band, so its
// collection leads; Without The Blacks and Say It Out Loud follow.
export const BOOK_SERIES: BookSeries[] = [
  {
    id: "melori-band",
    name: "The Melori Band",
    audience: "Picture books · ages 4–8",
    description:
      "Ten young musicians, one school band. Every book is a story about kindness, respect, and why school matters.",
    books: [
      {
        title: "Pip Speaks Up",
        badge: "Book 1",
        blurb:
          "Pip carries the microphone but never sings. When the school's instruments break, he finds his voice.",
        amazonUrl: "https://www.amazon.com/dp/B0HK65VHRR",
      },
      {
        title: "Luna and the Perfect Song",
        badge: "Book 2",
      },
      {
        title: "Bao and the Tough Look",
        badge: "Book 3",
      },
      {
        title: "Biscuit's Big Secret",
        badge: "Book 4",
        blurb:
          "Biscuit is hiding that he can't see the music, until a new pair of glasses changes everything.",
      },
      {
        title: "Fern's Five-String Guitar",
        badge: "Book 5",
        blurb: "A Melori Band story about finding your own sound.",
      },
      {
        title: "Nix and the Missing Music",
        badge: "Book 6",
        blurb: "A Melori Band story about fairness and finding the truth.",
      },
      { title: "Juno Skips Ahead", badge: "Book 7", live: false },
      { title: "Clover's Big, Beautiful Hair", badge: "Book 8", live: false },
      { title: "Tempo Finds the Beat", badge: "Book 9", live: false },
      { title: "Roz and All Ten", badge: "Book 10", live: false },
    ],
  },
  {
    id: "without-the-blacks",
    name: "Without The Blacks",
    audience: "History · teens, adults & schools",
    description:
      "What Black people built, and how it made everyday life easier for everyone. A three-volume history told in plain language. Facts only.",
    books: [
      {
        title: "The Beginning",
        badge: "Volume 1",
        blurb: "From the forming of the continents and the kingdom of Kush to the Middle Passage.",
      },
      {
        title: "The Builders",
        badge: "Volume 2",
        blurb: "The inventors and builders whose work runs through daily life.",
      },
      {
        title: "The Rise",
        badge: "Volume 3",
      },
    ],
  },
  {
    id: "say-it-out-loud",
    name: "Say It Out Loud",
    audience: "Teen & young adult",
    description:
      "Five couples face real relationship problems and talk them through, with each other and not with outsiders. Every story ends with an answer.",
    books: [
      {
        title: "The Table",
        badge: "Book 1",
        blurb: "Tobi and Dae, and a family that doesn't approve.",
      },
    ],
  },
  {
    id: "hikari-discovers",
    name: "Hikari Discovers",
    audience: "Activity books · ages 3–5",
    description:
      "Hikari is a tech-savvy kid with drones, gadgets and a robot partner, helping little learners discover how the world works.",
    books: [
      {
        title: "Hikari Discovers: How Things Work",
        badge: "Coloring book",
        blurb: "A coloring book that shows little ones how everyday things work.",
      },
      {
        title: "Hikari Discovers: Preschool Workbook",
        badge: "Workbook",
        blurb:
          "Letters, numbers, shapes, colors, tracing, sorting, patterns and early math.",
      },
    ],
  },
];

/** Pull the 10-character ASIN out of an Amazon /dp/ or /gp/product/ link. */
export function asinFrom(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

/** Amazon's public cover image for an ASIN. */
export function coverUrlFor(book: Book): string | null {
  const asin = asinFrom(book.amazonUrl);
  return asin ? `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg` : null;
}

/**
 * Where the button goes: the book's own page, or an Amazon search for it.
 * The search includes the series name, since titles like "The Beginning" are
 * too generic to find on their own.
 */
export function buyUrlFor(book: Book, seriesName?: string): string {
  if (book.amazonUrl) return book.amazonUrl;
  const words =
    seriesName && !book.title.includes(seriesName)
      ? `${seriesName} ${book.title} Karl Ray`
      : `${book.title} Karl Ray`;
  const q = encodeURIComponent(words);
  return `https://www.amazon.com/s?k=${q}&i=stripbooks`;
}
