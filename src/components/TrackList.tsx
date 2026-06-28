import type { Track } from "@/types";

// Stub — full implementation in Phase 1, Step 4.
export default function TrackList({ tracks }: { tracks: Track[] }) {
  return (
    <ul className="divide-y divide-brand-border">
      {tracks.map((track) => (
        <li key={track.id} className="py-2 flex justify-between">
          <span>{track.title}</span>
          <span className="text-text-secondary text-sm">{track.track_number}</span>
        </li>
      ))}
    </ul>
  );
}
