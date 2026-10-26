// Karl Ray's books, shown on /books.
//
// Melori sells nothing (see /mission). Each cover links out to the book's
// Amazon page, and Amazon handles the sale. Karl, 2026-10-03: no "Get it on
// Amazon" buttons — the cover IS the link, and the page doesn't advertise
// Amazon.
//
// HOW TO ADD OR FIX A BOOK
//   • `asin` is the 10-character code in the book's Amazon link
//     (amazon.com/dp/<ASIN>). The cover links there.
//   • `coverId` is the image code Amazon uses for the cover
//     (m.media-amazon.com/images/I/<coverId>.jpg). Copy it from the cover
//     image's address on the book's Amazon page.
//   • Set `live: false` for a book that isn't on Amazon yet. It shows under
//     "Coming next" with a title card and no link.
//
// Titles, subtitles and ASINs were read off Amazon's listing for Karl Ray on
// 2026-10-03.

export type Book = {
  title: string;
  /** e.g. "Book 1" — shown as a small badge. */
  badge?: string;
  blurb?: string;
  asin?: string;
  /**
   * A full store link (e.g. Google Play Books) for a book that isn't on
   * Amazon. Used instead of the Amazon link when set.
   */
  url?: string;
  coverId?: string;
  /**
   * A cover hosted on Melori itself (a path under /public), used before Amazon
   * has a cover for the book. Takes priority over `coverId`.
   */
  coverSrc?: string;
  live?: boolean;
};

export type BookSeries = {
  id: string;
  name: string;
  audience: string;
  description: string;
  books: Book[];
};

// Order is Karl's (2026-10-03; Was It Just Business? added after Without The
// Blacks 2026-10-17): The Melori Band is Melori's own band, so its
// collection leads; then Without The Blacks, Say It Out Loud, Right Before My
// Song, Denny, Hikari Discovers and WOE.
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
        asin: "B0HK65VHRR",
        coverId: "71P5rbHdu8L",
      },
      {
        title: "Luna and the Perfect Song",
        badge: "Book 2",
        blurb: "A story about learning from mistakes.",
        asin: "B0HKCJSCMX",
        coverId: "71KHWor+LKL",
      },
      {
        title: "Bao and the Tough Look",
        badge: "Book 3",
        blurb: "A story about courage and family.",
        asin: "B0HKCSNB74",
        coverId: "71Wpw6wps-L",
      },
      {
        title: "Biscuit's Big Secret",
        badge: "Book 4",
        blurb: "A story about asking for help.",
        asin: "B0HKD4WDY3",
        coverId: "71mkt4uJmoL",
      },
      {
        title: "Fern's Five-String Guitar",
        badge: "Book 5",
        blurb: "A story about finding your own sound.",
        asin: "B0HKDF8653",
        coverId: "71zSm7llrmL",
      },
      {
        title: "Nix and the Missing Music",
        badge: "Book 6",
        blurb: "A story about fairness and finding the truth.",
        asin: "B0HKVQST5V",
        coverId: "71z0lFzw95L",
      },
      {
        title: "Juno Skips Ahead",
        badge: "Book 7",
        blurb: "A story about patience and practice.",
        asin: "B0HL3XN74J",
        coverId: "91Pq-aC9wsL",
      },
      {
        title: "Clover's Big, Beautiful Hair",
        badge: "Book 8",
        blurb: "A story about self-love and respect.",
        asin: "B0HL6CCHXV",
        coverId: "91cNhjkJhrL",
      },
      {
        title: "Tempo Finds the Beat",
        badge: "Book 9",
        blurb: "A story about listening and teamwork.",
        // Kindle eBook (Karl, 2026-10-06: these two link to the ebooks).
        asin: "B0HLXYG57H",
        coverId: "51e+s5kB2HL",
      },
      {
        title: "Roz and All Ten",
        badge: "Book 10",
        blurb: "A story about leadership and sharing.",
        // Kindle eBook.
        asin: "B0HFDPJXKQ",
        coverId: "51amB0TN7NL",
      },
    ],
  },
  {
    id: "without-the-blacks",
    name: "Without The Blacks",
    audience: "History · teens, adults & schools",
    description:
      "What Black people built, and how it made everyday life easier for everyone. A true history in three volumes. Facts only.",
    books: [
      {
        title: "The Beginning",
        badge: "Volume 1",
        blurb: "From the forming of the continents and the kingdom of Kush to the Middle Passage.",
        asin: "B0HKG8QLHX",
        coverId: "61ziMZYkCNL",
      },
      {
        title: "The Builders",
        badge: "Volume 2",
        blurb: "The inventors and builders whose work runs through daily life.",
        asin: "B0HKG56KL5",
        coverId: "61r8Fc8krnL",
      },
      {
        title: "The Rise",
        badge: "Volume 3",
        asin: "B0HKG52HVD",
        coverId: "61HhavW6U3L",
      },
      {
        // Added 2026-10-17 (Karl). All three volumes in one Kindle eBook. Sits
        // AFTER Volumes 1–3 (Karl): placed first, it split the joined cover
        // spread across the three volumes.
        title: "The Complete Edition",
        badge: "Volumes 1–3",
        blurb: "All three volumes in one book.",
        asin: "B0HNDQHMZT",
        coverId: "81CxMK6G4HL",
      },
    ],
  },
  {
    // Added 2026-10-17 (Karl). Cover hosted on Melori. 2026-10-26 (Karl): the
    // cover links to the PAPERBACK (ASIN B0HP8XX7VG, live on KDP), not the
    // Kindle eBook (B0HP8RQJMR).
    id: "was-it-just-business",
    name: "Was It Just Business?",
    audience: "History · adults",
    description:
      "Slavery, the American ledger, and the account that was never settled. Who got paid, and who answered for it.",
    books: [
      {
        title: "Was It Just Business?",
        badge: "New",
        blurb: "Slavery, the American ledger, and the account that was never settled.",
        asin: "B0HP8XX7VG",
        coverSrc: "/images/books/was-it-just-business.jpg",
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
        asin: "B0HK89YRGN",
        coverId: "71E-b6QgnAL",
      },
      {
        title: "Plus One",
        badge: "Book 2",
        blurb: "Kai and Sol, and the best friend who still calls her Sunny.",
        asin: "B0HL6NP6VB",
        coverId: "81Q3SCxPEDL",
      },
      {
        // Added 2026-10-26: Kindle eBook, live since 2026-10-21 (no paperback yet).
        title: "The Difference",
        badge: "Book 3",
        blurb: "Dre and Imani, and what money was doing to them.",
        asin: "B0HNRBTP7W",
        coverId: "81jRAgwbtLL",
      },
    ],
  },
  {
    id: "right-before-my-song",
    name: "Right Before My Song",
    audience: "Nonfiction · stress & self-care",
    description:
      "A book about stress, from the one everybody calls: the strong one who takes care of everyone except themselves.",
    books: [
      {
        title: "Right Before My Song",
        asin: "B0HKVBQ21F",
        coverId: "611H+xWS+WL",
      },
    ],
  },
  {
    // Added 2026-10-15 (Karl). Kindle eBook, pre-order until it releases on
    // October 21, 2026, Denzel's birthday.
    id: "denny",
    name: "Denny: Never Give Up",
    audience: "Memoir · tribute",
    description:
      "One day in the life of Denzel Maurice Henderson, from the moment his eyes open until he goes to sleep. His motto: never give up.",
    books: [
      {
        title: "Denny: Never Give Up",
        blurb: "One Day in the Life of Denzel Maurice Henderson.",
        asin: "B0HMSBNGRR",
        coverId: "71Jb+pOxWSL",
      },
    ],
  },
  {
    id: "hikari-discovers",
    name: "Hikari Discovers",
    audience: "Activity books · ages 3–5",
    description:
      "Hikari builds things, flies drones, and figures out how the world works, and brings your child along with friends Ada and Rafi.",
    books: [
      {
        title: "Hikari Discovers",
        badge: "Workbook",
        asin: "B0HK3CLFHB",
        coverId: "71wl8VtQLlL",
      },
      {
        // Added 2026-10-15 (Karl).
        title: "How Things Work",
        badge: "Coloring Book",
        blurb: "A big coloring book: color Hikari and friends as they find out how things work.",
        asin: "B0HK539PD5",
        coverId: "71eXFgUhSTL",
      },
    ],
  },
  {
    id: "woe",
    name: "WOE",
    audience: "Fiction",
    description: "Some of it's joy and some of it's woe.",
    books: [
      {
        title: "WOE",
        blurb: "Carter Wilson has spent fifteen years reading faces. He has never turned the lens on himself.",
        asin: "B0HK7M9M97",
        coverId: "61Lr8Sv4XHL",
      },
    ],
  },
];

/** The book's cover image (Melori-hosted first, then Amazon's), or null. */
export function coverUrlFor(book: Book): string | null {
  if (book.coverSrc) return book.coverSrc;
  return book.coverId
    ? `https://m.media-amazon.com/images/I/${book.coverId}._SY450_.jpg`
    : null;
}

/** Where tapping the cover goes: the book's own store page. */
export function bookUrlFor(book: Book): string | null {
  if (book.url) return book.url;
  return book.asin ? `https://www.amazon.com/dp/${book.asin}` : null;
}
