// The small "E" mark shown beside a track the artist (or an admin) flagged as
// explicit — the same convention listeners know from other music apps.
//
// Server-safe (no hooks), so it renders in Server and Client Components alike.
// Renders nothing for a clean track, so callers can drop it in unconditionally:
//   <ExplicitBadge explicit={track.explicit} />
export default function ExplicitBadge({
  explicit,
  className = "",
}: {
  explicit?: boolean | null;
  className?: string;
}) {
  if (!explicit) return null;
  return (
    <span
      role="img"
      aria-label="Explicit"
      title="Explicit"
      className={`inline-flex h-4 min-w-4 shrink-0 select-none items-center justify-center rounded-[3px] bg-[#b2b2b2] px-1 align-middle text-[10px] font-bold leading-none text-[#121212] ${className}`}
    >
      E
    </span>
  );
}
