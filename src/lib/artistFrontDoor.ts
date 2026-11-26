// An artist page's "front door": a short Start here row above the full
// discography, the links out of the page, and one way for a fan to pay.
//
// Karl, 16 Nov 2026 — outside review of his page: 60+ releases in one flat
// grid ("steppers next to gospel next to kids' music") gave a new listener no
// path, the bio had no exits, and nothing told a fan how to support him.
//
// Melori itself takes no money (Karl, 8 Sep 2026), so `support` always points
// at an outside store. Karl chose RELAUNCH on Amazon Music (16 Nov).
//
// Keyed by artist slug. An artist with no entry renders exactly as before.
// `key` is a CatalogItem key: `release:<id>` (legacy releases) or
// `studio_album:<uuid>` / `studio_track:<uuid>` (Artist Studio uploads).
// A pinned key that no longer exists (hidden, deleted) is skipped silently.

export type StartHerePin = {
  key: string;
  /** Short reason to start here, shown above the cover ("Steppers"). */
  label: string;
  /** ISO date (exclusive). The pin disappears on this day — for seasonal picks. */
  until?: string;
};

export type ArtistLink = { label: string; href: string };

export type ArtistFrontDoor = {
  startHere: StartHerePin[];
  links: ArtistLink[];
  support?: { label: string; line: string; href: string };
};

// The WOE cast (Karl, 26 Nov 2026): every artist who plays a WOE character
// links to the novel. Points at the KDP edition, the one live on Amazon.
const WOE_NOVEL: ArtistLink = {
  label: "Read WOE, the novel",
  href: "https://www.amazon.com/dp/B0HK7M9M97",
};
const woeCast = (): ArtistFrontDoor => ({ startHere: [], links: [WOE_NOVEL] });

export const ARTIST_FRONT_DOORS: Record<string, ArtistFrontDoor> = {
  // WOE cast: RAH (Jennifer), Kaiel R (Carter), Gloria Joy Rivers (Trinity),
  // SHADAI (Patrice).
  rah: woeCast(),
  "kaiel-r": woeCast(),
  "gloria-joy-rivers": woeCast(),
  shadai: woeCast(),
  "karl-ray": {
    startHere: [
      // Through December (Karl's ask in the review: "Christmas with KRP should
      // sit at the top" while it's being pushed everywhere else).
      { key: "release:26", label: "Holiday", until: "2027-01-01" },
      { key: "release:21", label: "Steppers" },
      // RELAUNCH — his own voice (Artist Studio album).
      { key: "studio_album:aa169215-1c60-4643-8395-89c6d551df06", label: "Soul" },
      { key: "release:20", label: "Signature · the WOE soundtrack" },
    ],
    links: [
      { label: "Books", href: "/books" },
      { label: "Photography", href: "/photography" },
      { label: "YouTube", href: "https://www.youtube.com/@karlrayproduction" },
    ],
    support: {
      label: "Support Karl",
      line: "Get RELAUNCH on Amazon Music. Every purchase helps keep Melori free.",
      href: "https://www.amazon.com/dp/B0HKNJ43KR",
    },
  },
};

/** The pins still in season on `now`, in the order Karl set. */
export function activePins(door: ArtistFrontDoor, now: Date = new Date()): StartHerePin[] {
  const today = now.toISOString().slice(0, 10);
  return door.startHere.filter((p) => !p.until || today < p.until);
}
