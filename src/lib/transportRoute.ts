/**
 * Where the shared audio transport (the desktop bottom bar + the mobile
 * floating pill in src/components/AudioPlayer.tsx) is allowed to render.
 *
 * Product decision: the transport is a MAIN-PAGE-ONLY control. It used to be
 * mounted globally at the layout root, which meant every space — music, store,
 * social, studio, checkout, account, photography, admin — carried a fixed
 * playback bar plus the bottom clearance it reserved. It now renders on the
 * site root ("/") and nowhere else.
 *
 * Audio itself is NOT scoped by this: the <audio> element lives in
 * PlayerProvider at the layout root, so a track started on the main page keeps
 * playing while the listener browses the rest of the platform. Only the
 * transport UI is route-scoped.
 */
export function isTransportRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // Tolerate a trailing slash and a stray query/hash so the check never
  // depends on how the router happens to normalise the path.
  const path = pathname.split("?")[0].split("#")[0];
  return path === "/" || path === "";
}

export default isTransportRoute;
