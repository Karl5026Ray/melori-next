"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import { groupHits, searchSite, type SearchEntry, type SearchHit } from "@/lib/siteSearch";

// The search box and results for /search. The query lives in the URL (?q=) so
// a search can be shared, linked from anywhere, and survives the back button.

const PER_SECTION = 8;

function ResultRow({ hit }: { hit: SearchEntry | SearchHit }) {
  const matchedSong = "matchedSong" in hit ? hit.matchedSong : undefined;
  const body = (
    <>
      <CoverImage
        src={hit.image}
        alt=""
        name={hit.title}
        className="h-12 w-12 shrink-0"
        rounded={hit.kind === "artist" ? "rounded-full" : "rounded-md"}
      />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-text-primary">{hit.title}</span>
        <span className="block truncate text-sm text-text-secondary">
          {matchedSong ? `Song "${matchedSong}" · ` : ""}
          {hit.subtitle}
        </span>
      </span>
    </>
  );
  const cls =
    "flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-brand-surface";
  return hit.external ? (
    <a href={hit.href} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <Link href={hit.href} className={cls}>
      {body}
    </Link>
  );
}

export default function SearchClient({
  entries,
  suggestions,
}: {
  entries: SearchEntry[];
  suggestions: SearchEntry[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep ?q= in step with the box without adding a history entry per letter.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(Array.from(params.entries()));
      if (query.trim()) next.set("q", query.trim());
      else next.delete("q");
      const qs = next.toString();
      const current = params.toString();
      if (qs !== current) router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [query, params, pathname, router]);

  // Open ready to type, unless arriving with a query (then show results).
  useEffect(() => {
    if (!params.get("q")) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => groupHits(searchSite(entries, query)), [entries, query]);
  const typed = query.trim().length > 0;

  return (
    <div>
      <form role="search" onSubmit={(e) => e.preventDefault()} className="mb-6">
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Artists, songs, albums, books…"
          aria-label="Search Melori"
          className="w-full rounded-full border border-input-border bg-brand-surface px-5 py-3 text-base text-text-primary placeholder:text-text-secondary focus:border-brand-primary focus:outline-none"
        />
      </form>

      {!typed && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Artists on Melori
          </h2>
          <div className="grid gap-1 sm:grid-cols-2">
            {suggestions.map((s) => (
              <ResultRow key={s.key} hit={s} />
            ))}
          </div>
          <BrowseLinks />
        </section>
      )}

      {typed && groups.length === 0 && (
        <section aria-live="polite">
          <p className="font-semibold text-text-primary">Nothing found for &ldquo;{query.trim()}&rdquo;.</p>
          <p className="mt-1 text-text-secondary">
            Try fewer words, or just part of a name. Small typos are fine.
          </p>
          {suggestions.length > 0 && (
            <>
              <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">
                Maybe one of these artists
              </h2>
              <div className="grid gap-1 sm:grid-cols-2">
                {suggestions.slice(0, 4).map((s) => (
                  <ResultRow key={s.key} hit={s} />
                ))}
              </div>
            </>
          )}
          <BrowseLinks />
        </section>
      )}

      {typed &&
        groups.map((g) => {
          const open = expanded[g.kind];
          const shown = open ? g.hits : g.hits.slice(0, PER_SECTION);
          return (
            <section key={g.kind} className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">
                {g.label} <span className="font-normal">({g.hits.length})</span>
              </h2>
              <div className="grid gap-1">
                {shown.map((h) => (
                  <ResultRow key={h.key} hit={h} />
                ))}
              </div>
              {g.hits.length > PER_SECTION && !open && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [g.kind]: true }))}
                  className="mt-1 px-2 text-sm font-semibold text-brand-primary"
                >
                  Show all {g.hits.length}
                </button>
              )}
            </section>
          );
        })}
    </div>
  );
}

function BrowseLinks() {
  const links = [
    { href: "/music", label: "All music" },
    { href: "/artists", label: "All artists" },
    { href: "/books", label: "Books" },
    { href: "/social/radio", label: "Radio" },
  ];
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-full border border-brand-border px-4 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand-primary hover:text-brand-primary"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
