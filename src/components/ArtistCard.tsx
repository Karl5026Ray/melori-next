import type { Artist } from "@/types";

// Stub — full implementation in Phase 1, Step 4.
export default function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <p className="font-semibold">{artist.name}</p>
    </div>
  );
}
