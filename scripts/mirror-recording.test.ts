/* eslint-disable no-console */
// scripts/mirror-recording.test.ts
//
// Pins the RECORDING CONSENT + PRIVACY rules for Melori Mirror live recording.
//
// Before this change: egress wrote every recording into the PUBLIC
// social-videos bucket and stamped a public URL on the (publicly readable)
// spaces row the moment recording started; "Not now" deleted nothing; and only
// the host could see that the room was being recorded. Illinois is an
// all-party-consent state, so each of those is a real problem, not a nicety.
//
// What this pins (no network — pure helpers plus a read of the source files):
//   • key/bucket choice: egress targets the PRIVATE recordings bucket;
//   • no public URL exists before the host posts;
//   • "Not now" (discard) actually calls delete, on the private bucket, and
//     clears the space row — and stops short if the delete fails;
//   • the room-metadata flag that drives everyone's banner round-trips;
//   • a late joiner must consent before connecting; the host never is asked;
//   • the orphan finder never flags a posted recording.
//
// Run:  npx tsx scripts/mirror-recording.test.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_MIRROR_RECORDINGS_BUCKET,
  discardRecording,
  discardRecordingUpdate,
  findOrphans,
  initialConsentGate,
  isRoomRecording,
  publicObjectUrl,
  publicVideoBucket,
  recordingStorageKey,
  recordingsBucket,
  startRecordingUpdate,
  withRecordingFlag,
} from "@/lib/mirrorRecording";

let checks = 0;
let failures = 0;
const ok = (label: string) => { checks += 1; console.log(`  ok    ${label}`); };
const bad = (label: string) => { checks += 1; failures += 1; console.log(`  FAIL  ${label}`); };
const expect = (cond: boolean, label: string) => (cond ? ok(label) : bad(label));
const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

async function main() {
  // --- bucket + key choice ---------------------------------------------------
  console.log("bucket + key");
  expect(recordingsBucket({}) === "mirror-recordings", "recordings bucket defaults to mirror-recordings");
  expect(DEFAULT_MIRROR_RECORDINGS_BUCKET === "mirror-recordings", "default constant is mirror-recordings");
  expect(recordingsBucket({ MIRROR_RECORDINGS_BUCKET: "  " }) === "mirror-recordings", "blank env falls back to the private default");
  expect(recordingsBucket({ MIRROR_RECORDINGS_BUCKET: "rec-x" }) === "rec-x", "MIRROR_RECORDINGS_BUCKET overrides");
  expect(
    recordingsBucket({ STORAGE_S3_BUCKET: "social-videos" }) !== "social-videos",
    "the public STORAGE_S3_BUCKET does NOT leak into the recordings bucket",
  );
  expect(publicVideoBucket({}) === "social-videos", "public feed bucket defaults to social-videos");
  const key = recordingStorageKey("space_abc", new Date("2026-10-02T12:34:56.789Z"));
  expect(key === "mirror-live/space_abc/2026-10-02T12-34-56-789Z.mp4", `storage key shape (${key})`);
  expect(
    publicObjectUrl("https://x.supabase.co/", "social-videos", key) ===
      `https://x.supabase.co/storage/v1/object/public/social-videos/${key}`,
    "public URL builder (trailing slash tolerated)",
  );

  // --- no public URL before publish ------------------------------------------
  console.log("private until posted");
  const startUpd = startRecordingUpdate("EG_1", key);
  expect(startUpd.recording_url === null, "starting a recording writes recording_url = null");
  expect(startUpd.recording_storage_key === key && startUpd.is_recording, "start stores the private key + is_recording");
  const lk = src("src/lib/livekitServer.ts");
  expect(!/storage\/v1\/object\/public/.test(lk), "livekitServer builds no public object URL");
  expect(/bucket:\s*RECORDINGS_BUCKET/.test(lk), "egress S3 upload targets RECORDINGS_BUCKET");
  const startRoute = src("src/app/api/mirror/recording/start/route.ts");
  expect(!/publicUrl/.test(startRoute), "start route no longer stores a publicUrl");
  expect(
    startRoute.indexOf("setRoomRecordingFlag(roomName, true)") > -1 &&
      startRoute.indexOf("setRoomRecordingFlag(roomName, true)") < startRoute.indexOf("startRoomRecording(roomName)"),
    "start route notifies the room BEFORE egress begins",
  );
  const stopRoute = src("src/app/api/mirror/recording/stop/route.ts");
  expect(!/recordingUrl/.test(stopRoute), "stop route returns no recording URL");
  expect(/setRoomRecordingFlag\([^)]*false\)/.test(stopRoute), "stop route clears the banner flag");
  const publishRoute = src("src/app/api/mirror/recording/publish/route.ts");
  expect(/destinationBucket:\s*publicBucket/.test(publishRoute), "publish copies private -> public bucket");
  const migration = src("supabase/migrations/088_mirror_recordings_private_bucket.sql");
  expect(
    /insert into storage\.buckets[\s\S]*'mirror-recordings'[\s\S]*false[\s\S]*on conflict \(id\) do nothing/i.test(migration),
    "migration 086 creates mirror-recordings with public=false",
  );

  // --- banner flag -------------------------------------------------------------
  console.log("room metadata flag");
  expect(isRoomRecording(withRecordingFlag(null, true)), "flag on round-trips");
  expect(!isRoomRecording(withRecordingFlag(withRecordingFlag(null, true), false)), "flag off round-trips");
  const merged = JSON.parse(withRecordingFlag('{"theme":"x"}', true));
  expect(merged.theme === "x" && merged.recording === true, "other room-metadata keys are preserved");
  for (const raw of [null, "", "not json", "[]", '"true"', '{"recording":"true"}']) {
    expect(!isRoomRecording(raw), `garbage metadata ${JSON.stringify(raw)} is not 'recording'`);
  }

  // --- consent gate ------------------------------------------------------------
  console.log("join consent");
  expect(initialConsentGate({ isHost: false, recording: true }) === "needs-consent", "guest joining a recording must consent first");
  expect(initialConsentGate({ isHost: false, recording: false }) === "ok", "guest joining an unrecorded room goes straight in");
  expect(initialConsentGate({ isHost: true, recording: true }) === "ok", "host is never asked (they started it)");
  const room = src("src/components/social/faces/LiveRoom.tsx");
  expect(/if \(consentGate !== "ok"\) return;\s*let cancelled/.test(room), "LiveRoom does not connect (publish) until consent is ok");
  expect(/RecordingBanner/.test(room) && /roomRecording \|\|/.test(room), "LiveRoom shows the banner to every participant from the room flag");

  // --- discard ("Not now") -----------------------------------------------------
  console.log("discard deletes");
  const calls: string[] = [];
  const res = await discardRecording(
    { recording_egress_id: "EG_1", recording_storage_key: key },
    "mirror-recordings",
    {
      waitForEgressEnd: async (id) => { calls.push(`wait:${id}`); },
      removeObject: async (b, k) => { calls.push(`remove:${b}/${k}`); return { error: null }; },
      clearSpace: async (u) => { calls.push(`clear:${JSON.stringify(u)}`); return { error: null }; },
    },
  );
  expect(res.ok && res.deleted, "discard reports ok + deleted");
  expect(calls[0] === "wait:EG_1", "discard waits for egress to finish before deleting");
  expect(calls[1] === `remove:mirror-recordings/${key}`, "discard deletes the object from the PRIVATE bucket");
  expect(calls[2] === `clear:${JSON.stringify(discardRecordingUpdate())}`, "discard clears the space row's recording columns");
  const cleared = discardRecordingUpdate();
  expect(
    cleared.recording_url === null && cleared.recording_storage_key === null && cleared.recording_egress_id === null && !cleared.is_recording,
    "cleared row keeps nothing about the deleted recording",
  );

  const failCalls: string[] = [];
  const failed = await discardRecording(
    { recording_egress_id: null, recording_storage_key: key },
    "mirror-recordings",
    {
      waitForEgressEnd: async () => { failCalls.push("wait"); },
      removeObject: async () => ({ error: "boom" }),
      clearSpace: async () => { failCalls.push("clear"); return { error: null }; },
    },
  );
  expect(!failed.ok && failed.error === "boom", "a failed delete is reported, not swallowed");
  expect(!failCalls.includes("clear"), "a failed delete does NOT clear the row (host can retry)");
  expect(!failCalls.includes("wait"), "no egress id -> no egress wait");

  const controls = src("src/components/social/mirror/MirrorRecordingControls.tsx");
  expect(/\/api\/mirror\/recording\/discard/.test(controls), "the 'Not now' handler calls the discard route");

  // --- orphan finder -----------------------------------------------------------
  console.log("orphans");
  const objs = [
    { key: "mirror-live/space_a/1.mp4", size: 10 },
    { key: "mirror-live/space_b/2.mp4", size: 20 },
    { key: "mirror-live/space_c/3.mp4", size: 30 },
    { key: "social/user/clip.mp4", size: 40 },
  ];
  const orphans = findOrphans(
    objs,
    ["https://x.supabase.co/storage/v1/object/public/social-videos/mirror-live/space_a/1.mp4?v=1", null],
    ["mirror-live/space_c/3.mp4"],
  );
  expect(orphans.length === 1 && orphans[0].key === "mirror-live/space_b/2.mp4", "only the unposted, not-in-progress recording is an orphan");
  expect(!orphans.some((o) => o.key.startsWith("social/")), "objects outside mirror-live/ are never touched");
  const orphanScript = src("scripts/mirror-orphans.ts");
  expect(/doDelete:\s*args\.includes\("--delete"\)/.test(orphanScript), "orphan script deletes only with --delete");
  expect(/if \(!doDelete\)[\s\S]*return;/.test(orphanScript), "orphan script returns before deleting on a dry run");

  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}

void main();
