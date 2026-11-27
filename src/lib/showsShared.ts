// Client-safe pieces of src/lib/shows.ts (types, slug, length label). Kept
// apart so a client component never pulls the server Supabase reader into
// the browser bundle.

export interface ShowPart {
  id: string;
  title: string;
  durationSeconds: number | null;
}

export interface PublicShow {
  slug: string;
  name: string;
  host: string;
  coverUrl: string | null;
  parts: ShowPart[];
  totalSeconds: number;
  createdAt: string;
}

export function showSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "show"
  );
}

export function formatShowLength(seconds: number): string {
  if (!seconds) return "";
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
}
