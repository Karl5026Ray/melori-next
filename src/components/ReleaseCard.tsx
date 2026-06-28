import type { Release } from "@/types";

// Stub — full implementation in Phase 1, Step 4.
export default function ReleaseCard({ release }: { release: Release }) {
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <p className="font-semibold">{release.title}</p>
      <p className="text-xs text-text-secondary capitalize">{release.release_type}</p>
    </div>
  );
}
