// An opened MM Spaces room is a full-screen surface: no app header, no tab
// bar. The Spaces list and the create form keep the app navigation.
// Spaces' own copy of this rule; Cinema's lives in cinemaRoomRoute.ts.
export function isSpacesLiveRoomRoute(pathname: string | null | undefined): boolean {
  const normalizedPath = pathname?.replace(/\/+$/, "") ?? "";
  return (
    /^\/social\/spaces\/[^/]+$/.test(normalizedPath) &&
    normalizedPath !== "/social/spaces/create"
  );
}
