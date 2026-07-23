"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

interface ReleaseResult {
  id: number;
  title: string;
  slug: string;
  cover_art_url: string | null;
  artistName: string | null;
}
interface ArtistResult {
  id: number;
  name: string;
  slug: string;
  avatar_url: string | null;
}
interface ProfileResult {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}
interface SpaceResult {
  id: string;
  title: string | null;
  topic: string | null;
}
interface VideoResult {
  id: string;
  title: string | null;
}
interface SearchResults {
  releases: ReleaseResult[];
  artists: ArtistResult[];
  profiles: ProfileResult[];
  spaces: SpaceResult[];
  videos: VideoResult[];
}

const EMPTY: SearchResults = {
  releases: [],
  artists: [],
  profiles: [],
  spaces: [],
  videos: [],
};

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const [value, setValue] = useState(initialQ);
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync if the URL query changes externally (back/forward).
  useEffect(() => {
    setValue(params.get("q") ?? "");
  }, [params]);

  // Debounced fetch + URL sync as the user types.
  useEffect(() => {
    const q = value.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
      if (q.length < 2) {
        setResults(EMPTY);
        setLoading(false);
        return;
      }
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => setResults(data.results ?? EMPTY))
        .catch(() => setResults(EMPTY))
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, router]);

  const total = useMemo(
    () =>
      results.releases.length +
      results.artists.length +
      results.profiles.length +
      results.spaces.length +
      results.videos.length,
    [results],
  );

  const trimmed = value.trim();

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">Search</h1>
      <input
        type="search"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search artists, releases, people, spaces…"
        className="w-full rounded-lg border border-brand-border bg-brand-surface px-4 py-3 text-text-primary outline-none focus:border-brand-primary"
      />

      <div className="mt-8 space-y-8">
        {trimmed.length < 2 && (
          <p className="text-text-secondary">Type to search…</p>
        )}
        {trimmed.length >= 2 && loading && (
          <p className="text-text-secondary">Searching…</p>
        )}
        {trimmed.length >= 2 && !loading && total === 0 && (
          <p className="text-text-secondary">No results for “{trimmed}”.</p>
        )}

        {results.artists.length > 0 && (
          <Section title="Artists">
            {results.artists.map((a) => (
              <Link
                key={a.id}
                href={`/artists/${a.slug}`}
                className="block rounded-md px-3 py-2 text-text-primary hover:bg-brand-muted"
              >
                {a.name}
              </Link>
            ))}
          </Section>
        )}

        {results.releases.length > 0 && (
          <Section title="Releases">
            {results.releases.map((r) => (
              <Link
                key={r.id}
                href={`/albums/${r.slug}`}
                className="block rounded-md px-3 py-2 text-text-primary hover:bg-brand-muted"
              >
                {r.title}
                {r.artistName && (
                  <span className="text-text-secondary"> — {r.artistName}</span>
                )}
              </Link>
            ))}
          </Section>
        )}

        {results.profiles.length > 0 && (
          <Section title="People">
            {results.profiles.map((p) => {
              const label = p.display_name || p.username || "User";
              return p.username ? (
                <Link
                  key={p.id}
                  href={`/social/profile/${p.username}`}
                  className="block rounded-md px-3 py-2 text-text-primary hover:bg-brand-muted"
                >
                  {label}
                </Link>
              ) : (
                <span
                  key={p.id}
                  className="block rounded-md px-3 py-2 text-text-secondary"
                >
                  {label}
                </span>
              );
            })}
          </Section>
        )}

        {results.spaces.length > 0 && (
          <Section title="Live Spaces">
            {results.spaces.map((s) => (
              <Link
                key={s.id}
                href="/social/spaces"
                className="block rounded-md px-3 py-2 text-text-primary hover:bg-brand-muted"
              >
                {s.title || "Live space"}
                {s.topic && (
                  <span className="text-text-secondary"> — {s.topic}</span>
                )}
              </Link>
            ))}
          </Section>
        )}

        {results.videos.length > 0 && (
          <Section title="Videos">
            {results.videos.map((v) => (
              <Link
                key={v.id}
                href="/social/mirror"
                className="block rounded-md px-3 py-2 text-text-primary hover:bg-brand-muted"
              >
                {v.title || "Video"}
              </Link>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary/70">
        {title}
      </h2>
      <div className="rounded-lg border border-brand-border bg-brand-surface p-1">
        {children}
      </div>
    </section>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto px-4 py-8 text-text-secondary">
          Loading…
        </div>
      }
    >
      <SearchInner />
    </Suspense>
  );
}
