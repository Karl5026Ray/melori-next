import { isCinemaLiveRoomRoute } from "@/lib/cinemaRoomRoute";

/**
 * Routes that own real-time audio/video and must suppress the global music
 * transport. Discover and create pages remain normal app surfaces.
 */
export function isMediaRoomRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/social/live")) return true;
  if (pathname.startsWith("/social/connect")) return true;

  const concert = pathname.match(/^\/social\/concert\/([^/]+)/);
  if (concert && concert[1] !== "create") return true;

  const spaces = pathname.match(/^\/social\/spaces\/([^/]+)/);
  if (spaces && spaces[1] !== "create") return true;

  // Cinema deliberately has a stricter boundary than the legacy room routes:
  // suppress the shared transport only while an actual single-id Cinema room
  // is open. The discover/create pages (and unrelated nested paths) retain
  // normal application controls.
  return isCinemaLiveRoomRoute(pathname);
}
