/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}`);
  }
}

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/057_cinema_camera_slots.sql"),
  "utf8",
);
const roomHost = readFileSync(join(root, "src/lib/roomHost.ts"), "utf8");
const livekitServer = readFileSync(join(root, "src/lib/livekitServer.ts"), "utf8");
const participantRoute = readFileSync(
  join(root, "src/app/api/social/spaces/[spaceId]/participants/[userId]/route.ts"),
  "utf8",
);
const cameraSlotRoute = readFileSync(
  join(root, "src/app/api/social/spaces/[spaceId]/cinema-camera-slot/route.ts"),
  "utf8",
);
const livekitWebhook = readFileSync(
  join(root, "src/app/api/livekit/webhook/route.ts"),
  "utf8",
);
const videoClient = readFileSync(join(root, "src/lib/livekitVideoClient.ts"), "utf8");
// The room screen moved out of the Spaces route when Cinema was split onto
// /social/cinema/[roomId]: both routes are now thin wrappers that render this
// shared component, so the client-side invariants live here.
const cinemaPage = readFileSync(
  join(root, "src/components/social/rooms/RoomScreen.tsx"),
  "utf8",
);
const cinemaCanvas = readFileSync(
  join(root, "src/components/social/cinema/CinemaRoomCanvas.tsx"),
  "utf8",
);
const cinemaStage = readFileSync(
  join(root, "src/components/social/cinema/CinemaStage.tsx"),
  "utf8",
);
const cinemaScreen = readFileSync(
  join(root, "src/components/social/cinema/CinemaScreen.tsx"),
  "utf8",
);
const cinemaVoiceCircles = readFileSync(
  join(root, "src/components/social/cinema/CinemaVoiceCircles.tsx"),
  "utf8",
);
const cinemaChat = readFileSync(
  join(root, "src/components/social/cinema/CinemaChat.tsx"),
  "utf8",
);
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
const mobileTabBar = readFileSync(join(root, "src/components/MobileTabBar.tsx"), "utf8");
const cinemaRoute = readFileSync(join(root, "src/lib/cinemaRoomRoute.ts"), "utf8");

console.log("\nCinema server invariants");
check(
  "host slot zero follows host_id in the same spaces update transaction",
  /after insert or update of host_id, room_format on public\.spaces/.test(migration) &&
    /delete from public\.cinema_camera_slots[\s\S]*slot = 0 or user_id = new\.host_id/.test(
      migration,
    ),
);
check(
  "ordinary host promotion does not call a Cinema-only transfer RPC",
  !roomHost.includes("transfer_cinema_host_camera_slot"),
);
check(
  "guest claims lock and validate the participant before choosing a slot",
  /from public\.spaces[\s\S]*for update;[\s\S]*from public\.space_participants sp[\s\S]*for update;[\s\S]*participant is not eligible/.test(
    migration,
  ) && !migration.includes("pg_advisory_xact_lock"),
);
check(
  "moderation releases a guest slot only after runtime revocation",
  participantRoute.lastIndexOf("revokePublishedSources(") <
    participantRoute.lastIndexOf('rpc("release_cinema_camera_slot"'),
);
check(
  "normal camera-off preserves microphone-only room participation",
  !cameraSlotRoute.includes("disconnectOnCamera: true") &&
    !livekitWebhook.includes("disconnectOnCamera: true") &&
    /await revokePublishedSources\(roomName, params\.userId, \["microphone", "camera"\]\);/.test(
      participantRoute,
    ),
);
check(
  "slot mutation RPCs remain service-role-only",
  /revoke all on function public\.claim_cinema_camera_slot/.test(migration) &&
    /grant execute on function public\.claim_cinema_camera_slot[\s\S]*to service_role/.test(
      migration,
    ),
);
check(
  "LiveKit permission and revocation errors propagate",
  /updateParticipant failed/.test(livekitServer) === false &&
    /revokePublishedSources failed/.test(livekitServer) === false,
);
check(
  "Cinema publishers only auto-enable mic from explicit persisted state",
  /if \(opts\.autoEnableMicrophone\)/.test(videoClient) &&
    /autoEnableMicrophone: !myPart\.is_muted && !myPart\.host_muted/.test(cinemaPage),
);
check(
  "only the current host can assign or remove another Cinema guest",
  /targetId !== callerId && !isCurrentHost/.test(cameraSlotRoute) &&
    /targetId !== callerId && callerId !== space\.host_id/.test(cameraSlotRoute) &&
    cameraSlotRoute.includes("Only the current host can assign a live box") &&
    cameraSlotRoute.includes("Only the current host can remove another guest"),
);
check(
  "an unselected guest cannot self-claim, while a selected guest can verify idempotently",
  /const isSelfGuestClaim = targetId === callerId && !isCurrentHost;/.test(cameraSlotRoute) &&
    /if \(isSelfGuestClaim && !selfReservation\)/.test(cameraSlotRoute) &&
    cameraSlotRoute.includes("The host must add you to a live box") &&
    /if \(isSelfGuestClaim && created\)/.test(cameraSlotRoute),
);

console.log("\nCinema camera client invariants");
check(
  "camera publish waits for the runtime grant to reach this client",
  /await awaitPublishPermission\("camera"\)/.test(videoClient) &&
    /read: \(\) => session\.localPermissions/.test(videoClient),
);
check(
  "the full permission object is recorded, not just canPublish",
  /session\.localPermissions = participant\.permissions \?\? null/.test(videoClient),
);
check(
  "turning the camera on while disconnected fails instead of reporting success",
  /if \(!session\.room\) \{\s*\n\s*if \(!enabled\) return;\s*\n\s*throw new Error/.test(videoClient),
);
check(
  "a publish with no attachable camera track throws so the caller can undo",
  /if \(!track\?\.attach\) \{[\s\S]*throw new Error\("The camera did not start/.test(videoClient),
);
check(
  "a revoked camera source drops the local preview",
  /!permissionsAllowSource\(session\.localPermissions, "camera"\)[\s\S]*onLocalVideoRemoved\?\.\(\)/.test(
    videoClient,
  ),
);
check(
  "a stranded camera claim is never left holding a seat silently",
  // Both the success and failure paths re-read durable slot state, and the
  // failure path still runs the existing release.
  /catch \(err\) \{[\s\S]*setShareToast\([\s\S]*await refreshCinemaSlots\(\);\s*\n\s*\} finally \{/.test(
    cinemaPage,
  ) && /method: "DELETE"/.test(cinemaPage),
);
check(
  "the camera control is disabled until the room is connected",
  /disabled=\{!cinemaRoomConnected \|\| cinemaCameraBusy\}/.test(cinemaPage) &&
    /if \(!cinemaRoomConnected\)/.test(cinemaPage),
);
check(
  "camera resume is per-page-session intent, never a bare reservation",
  /autoEnableCamera: resumeCamera/.test(cinemaPage) &&
    /const resumeCamera = cinemaCameraIntentRef\.current/.test(cinemaPage) &&
    !/autoEnableCamera: cinemaReservations/.test(cinemaPage),
);
check(
  "Cinema exposes host-only live-box controls and selected-guest readiness",
  /isCinema && isHost/.test(cinemaPage) &&
    /data-testid="cinema-live-box-controls"/.test(cinemaPage) &&
    /data-testid=\{`cinema-live-box-\$\{boxNumber\}`\}/.test(cinemaPage) &&
    /data-testid="cinema-selected-guest-readiness"/.test(cinemaPage) &&
    /isCinema && \(isHost \|\| selectedCinemaGuest\)/.test(cinemaPage),
);

check(
  "Cinema uses its own non-scrolling live-video canvas instead of generic stage ordering",
  cinemaPage.includes("<CinemaRoomCanvas") &&
    cinemaCanvas.includes('data-testid="cinema-room-canvas"') &&
    cinemaCanvas.includes("overflow-hidden") &&
    // Non-Cinema rooms gate StageGrid behind `!isCinema` — this used to be a
    // single combined grid, and is now a separate Stage section and Audience
    // section (see RoomScreen's Stage/Audience split), so the literal source
    // text changed. The invariant that actually matters, that Cinema itself
    // never falls into this generic StageGrid branch, still holds either way.
    /\{!isCinema[\s\S]{0,400}?<StageGrid/.test(cinemaPage),
);
check(
  "three ordered live video seats are their own band below the screen, never overlaying it",
  cinemaStage.includes('className="grid shrink-0 grid-cols-3 gap-1.5 sm:gap-2"') &&
    !cinemaStage.includes("absolute bottom-2 left-2 right-12") &&
    !cinemaStage.includes("embedded") &&
    cinemaCanvas.includes("{seats}") &&
    cinemaStage.includes('data-camera-seat={seat.slot === 0 ? "host"') &&
    cinemaStage.includes('data-testid="cinema-camera-placeholder"') &&
    cinemaStage.includes("camera is off or offline") &&
    cinemaScreen.includes('data-testid="cinema-fullscreen-control"'),
);
check(
  "the voice audience is rows of volume-ringed circles and excludes every fixed seat identity",
  cinemaPage.includes("const cinemaSeatUserIds = new Set(") &&
    cinemaPage.includes("const cinemaAudience = withSpeaking.filter(") &&
    cinemaVoiceCircles.includes('data-testid="cinema-voice-circles"') &&
    cinemaVoiceCircles.includes('data-testid="cinema-voice-row"') &&
    cinemaVoiceCircles.includes('data-testid="cinema-voice-ring"') &&
    cinemaVoiceCircles.includes("splitVoiceRows(visible, VOICE_ROW_COUNT)") &&
    // Nothing in this block hides people behind a scroll the way the old single
    // strip did; a packed room is capped and the rest becomes one visible chip,
    // so the block can never push the shared screen out of the viewport.
    cinemaVoiceCircles.includes("flex flex-wrap") &&
    !cinemaVoiceCircles.includes("overflow-x-auto") &&
    !cinemaVoiceCircles.includes("overflow-y-auto") &&
    cinemaVoiceCircles.includes("partitionVoiceAudience(audience)") &&
    cinemaVoiceCircles.includes('data-testid="cinema-voice-overflow"'),
);
check(
  "volume rings are driven by real sampled LiveKit loudness, not a canned animation",
  cinemaPage.includes("onAudioLevels: (levels) =>") &&
    cinemaPage.includes("levels={cinemaAudioLevels}") &&
    cinemaVoiceCircles.includes("voiceRing({") &&
    cinemaVoiceCircles.includes("transform: `scale(${ring.scale})`"),
);
check(
  "Cinema comments are a left-side five-line transient overlay",
  cinemaChat.includes("return next.slice(-5)") &&
    cinemaChat.includes("absolute bottom-2 left-2") &&
    cinemaChat.includes('data-testid="cinema-comment-line"') &&
    cinemaChat.includes("CINEMA_COMMENT_EXIT_MS") &&
    cinemaChat.includes("data-cinema-comment-age") &&
    globals.includes("@keyframes cinemaCommentEnter") &&
    globals.includes("data-cinema-comment-exiting"),
);
check(
  "Cinema preserves a safe top inset without shrinking the media stage",
  globals.includes("body:has(.cinema-room-shell)") &&
    globals.includes("padding-bottom: 0 !important") &&
    globals.includes("--cinema-safe-area-top") &&
    globals.includes(".cinema-room-shell") &&
    cinemaPage.includes('data-testid={isCinema ? "cinema-room-header" : undefined}') &&
    cinemaPage.includes("h-[100dvh]") &&
    cinemaPage.includes("flex-1") &&
    /!isCinema && !isHost && !canSpeakNow && canRaiseHandNow/.test(cinemaPage) &&
    /!isCinema && canSpeakNow/.test(cinemaPage),
);
check(
  "Cinema live-seat management is a focus-contained accessible dialog",
  cinemaPage.includes('role="dialog"') &&
    cinemaPage.includes('aria-modal="true"') &&
    cinemaPage.includes('aria-describedby="cinema-live-boxes-description"') &&
    cinemaPage.includes("cinemaSeatsDialogRef") &&
    cinemaPage.includes('event.key === "Escape"') &&
    cinemaPage.includes("cinemaSeatsTriggerRef.current?.focus()"),
);
check(
  "Cinema suppresses document scrolling and generic raise-hand controls",
  globals.includes("body:has(.cinema-room-shell)") &&
    globals.includes("padding-bottom: 0 !important") &&
    /!isCinema && !isHost && !canSpeakNow && canRaiseHandNow/.test(cinemaPage) &&
    /!isCinema && canSpeakNow/.test(cinemaPage),
);
check(
  "Cinema removes global mobile navigation only for opened room routes",
  mobileTabBar.includes("isCinemaRoomRoute") &&
    mobileTabBar.includes("isCinemaLiveRoomRoute(pathname)") &&
    cinemaRoute.includes('normalizedPath !== "/social/cinema/create"') &&
    cinemaRoute.includes('^\\/social\\/cinema\\/[^/]+$'),
);

console.log(
  failures === 0
    ? "\nAll Cinema server-invariant assertions passed.\n"
    : `\n${failures} Cinema server-invariant assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
