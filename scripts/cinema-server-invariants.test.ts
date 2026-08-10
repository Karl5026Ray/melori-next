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

console.log(
  failures === 0
    ? "\nAll Cinema server-invariant assertions passed.\n"
    : `\n${failures} Cinema server-invariant assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
