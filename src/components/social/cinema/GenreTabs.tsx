import Link from "next/link";
import { CINEMA_GENRE_TABS } from "@/lib/cinema";

// Genre filter row from the discover mockup: live now | hip hop | r&b |
// afrobeats | pop, with the active tab underlined in gold.
//
// Deliberately Links (?genre=slug) rather than client state: the discover data
// is server-rendered, so routing the filter through the URL keeps one source of
// truth, makes a filtered view shareable, and keeps this a server component.
export function GenreTabs({ active }: { active: string | null }) {
  return (
    <nav
      aria-label="Filter rooms by genre"
      // Scrolls horizontally rather than wrapping: five lowercase tabs just fit
      // a 390px phone, but a longer genre list must not push the featured card
      // below the fold.
      className="-mx-4 flex gap-5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {CINEMA_GENRE_TABS.map((tab) => {
        const current = tab.slug === active;
        return (
          <Link
            key={tab.label}
            href={tab.slug ? `/social/cinema?genre=${tab.slug}` : "/social/cinema"}
            aria-current={current ? "page" : undefined}
            className={`shrink-0 border-b-2 pb-1.5 text-sm lowercase transition-colors ${
              current
                ? "border-cinema-gold font-medium text-cinema-gold"
                : "border-transparent text-white/45 hover:text-white/75"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
