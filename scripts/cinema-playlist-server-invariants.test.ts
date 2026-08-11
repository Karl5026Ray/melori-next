/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}`);
  }
}

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/059_cinema_playback_playlist.sql"),
  "utf8",
);
const route = readFileSync(
  join(root, "src/app/api/social/spaces/[spaceId]/playback/route.ts"),
  "utf8",
);
const screen = readFileSync(
  join(root, "src/components/social/cinema/CinemaScreen.tsx"),
  "utf8",
);
const picker = readFileSync(
  join(root, "src/components/social/cinema/CinemaSourcePicker.tsx"),
  "utf8",
);
const youtube = readFileSync(
  join(root, "src/components/social/cinema/CinemaYouTubePlayer.tsx"),
  "utf8",
);

console.log("\nCinema playlist server invariants");
check(
  "database enforces an array with no more than five items",
  migration.includes("jsonb_typeof(playlist_items) = 'array'") &&
    migration.includes("jsonb_array_length(playlist_items) <= 5"),
);
check(
  "playlist mutation locks and rechecks the room host",
  /from public\.spaces[\s\S]*for update/.test(migration) &&
    migration.includes("v_space.host_id <> p_actor_id"),
);
check(
  "playlist RPC is service-role only",
  /revoke all on function public\.mutate_cinema_playlist[\s\S]*from public, anon, authenticated/.test(
    migration,
  ) &&
    /grant execute on function public\.mutate_cinema_playlist[\s\S]*to service_role/.test(
      migration,
    ),
);
check(
  "active queue item remains mirrored into the legacy source fields",
  migration.includes("source_url = v_source_url") &&
    migration.includes("source_type = v_source_type"),
);
check(
  "the route canonicalizes appended URLs before the RPC",
  /action === "append"[\s\S]*classifySource\(rawUrl\)/.test(route) &&
    route.includes("randomUUID()"),
);
check(
  "revision conflicts refresh the host instead of replaying blindly",
  route.includes('error.code === "40001"') && route.includes("status === 409"),
);

console.log("\nCinema playlist client invariants");
check(
  "the host can append, select, reorder, and remove queue items",
  /action: "append"/.test(screen) &&
    /action: "select"/.test(screen) &&
    /action: "move"/.test(screen) &&
    /action: "remove"/.test(screen),
);
check(
  "both native and YouTube endings advance the active item",
  screen.includes("onEnded={hostAdvance}") &&
    youtube.includes("onEndedRef.current?.()"),
);
check(
  "link input accepts a batch capped by remaining slots",
  picker.includes(".split(/\\s+/)") &&
    picker.includes("links.length > remainingSlots"),
);
check(
  "the existing two-gigabyte upload ceiling remains in the picker",
  picker.includes("MAX_UPLOAD_BYTES") &&
    picker.includes("file.size > MAX_UPLOAD_BYTES"),
);

console.log(
  failures === 0
    ? "\nAll Cinema playlist invariant assertions passed.\n"
    : `\n${failures} Cinema playlist invariant assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
