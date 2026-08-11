/**
 * Routes that own real-time audio/video and must suppress the global music
 * transport. Discover and create pages remain normal app surfaces.
 */
export function isMediaRoomRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/social/live")) return true;
  if (pathname.startsWith("/social/connect")) return true;

  const spaces = pathname.match(/^\/social\/spaces\/([^/]+)/);
  if (spaces && spaces[1] !== "create") return true;

  const cinema = pathname.match(/^\/social\/cinema\/([^/]+)/);
  return Boolean(cinema && cinema[1] !== "create");
}
