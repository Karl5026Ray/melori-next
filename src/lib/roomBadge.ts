// The trusted-helper badge on a room participant (migration 017). The server
// treats 'mod' and 'cohost' alike as moderators (see the participants route
// and src/lib/auditions.server.ts), so every surface that labels a moderator
// reads it through this one check rather than comparing strings in place.
export function isModeratorBadge(badge: string | null | undefined): boolean {
  return badge === "mod" || badge === "cohost";
}
