/**
 * Cinema listing and creation routes retain the application navigation. Only
 * an opened, single-id Cinema room becomes the fullscreen live-video surface.
 */
export function isCinemaLiveRoomRoute(pathname: string | null | undefined): boolean {
  const normalizedPath = pathname?.replace(/\/+$/, "") ?? "";
  return (
    /^\/social\/cinema\/[^/]+$/.test(normalizedPath) &&
    normalizedPath !== "/social/cinema/create"
  );
}
