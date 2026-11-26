/* eslint-disable no-console */
// scripts/radio-hosts.test.ts
//
// Pins the Melori Radio host rules (Karl, 26 Nov 2026): Karl Ray and Jade talk
// between records on the shuffled stations.
//   • an artist intro plays right before any song that has one;
//   • a station ID plays after every N songs (manifest.everySongs);
//   • rebuilding a rotation never doubles the hosts up;
//   • "Next" on the Radio page always names a song, never a host clip;
//   • the manifest only accepts our own /radio/voice/*.mp3 clips;
//   • every clip the shipped manifest names exists in /public;
//   • recorded shows stay out of the song shuffle.
import fs from "node:fs";
import path from "node:path";

let checks = 0;
let failures = 0;
const check = (cond: boolean, l: string) => {
  checks += 1;
  if (!cond) failures += 1;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${l}`);
};
const root = path.join(__dirname, "..");

async function main() {
  const { withHosts, parseManifest, stripVoice, nextSong, isVoice } = await import(
    "../src/lib/radioHosts"
  );
  type T = { id: number | string; sourceType?: string; title: string; artistName: string | null; coverUrl: string | null; src?: string };
  const song = (id: number): T => ({ id, sourceType: "legacy", title: `S${id}`, artistName: `A${id}`, coverUrl: null });
  const songs = [1, 2, 3, 4, 5, 6, 7].map(song);
  const m = parseManifest({
    version: 1,
    everySongs: 3,
    stationIds: ["/radio/voice/id_01.mp3", "/radio/voice/id_02.mp3"],
    intros: { "legacy:2": "/radio/voice/intro_02.mp3", "legacy:4": "/radio/voice/intro_04.mp3" },
  })!;
  check(m !== null, "valid manifest parses");

  const r = withHosts(songs, m, 0);
  const shape = r.map((t: T) => (isVoice(t) ? (String(t.id).startsWith("id:") ? "ID" : "IN") : String(t.id))).join(" ");
  check(shape === "1 IN 2 3 ID IN 4 5 6 ID 7", `rotation shape (${shape})`);
  check(r[1].src === "/radio/voice/intro_02.mp3", "intro sits right before its own song");
  check(stripVoice(r).length === songs.length, "every song is still there exactly once");
  check(withHosts(r, m, 0).length === r.length, "re-hosting a hosted rotation does not double the hosts");
  check(!isVoice(r[0]), "a rotation never opens on a station ID");
  check(withHosts(songs, null).length === songs.length, "no manifest → songs only");

  check(nextSong(r, 0)?.id === 2, "Next skips the intro and names the song");
  check(nextSong(r, r.length - 1)?.id === 1, "Next wraps to the top");

  check(parseManifest({ stationIds: ["https://evil.example/x.mp3"], intros: { "legacy:1": "javascript:alert(1)" } }) === null, "foreign clip URLs are rejected");
  check(parseManifest({ stationIds: ["/radio/voice/id_01.mp3"], everySongs: 0 })!.everySongs === 3, "bad everySongs falls back to 3");

  const shipped = parseManifest(JSON.parse(fs.readFileSync(path.join(root, "public/radio/hosts.json"), "utf8")))!;
  check(shipped !== null && shipped.stationIds.length >= 4, "shipped manifest has station IDs");
  const clips = [...shipped.stationIds, ...Object.values(shipped.intros)];
  const missing = clips.filter((c) => !fs.existsSync(path.join(root, "public", c)));
  check(missing.length === 0, `every manifest clip exists in /public (${missing.length} missing)`);
  check(fs.existsSync(path.join(root, "public/radio/melori-radio-cover.jpg")), "host cover art exists");

  const data = fs.readFileSync(path.join(root, "src/lib/data.ts"), "utf8");
  const pool = data.slice(data.indexOf("export async function getRadioPool"), data.indexOf("export async function getRadioShows"));
  check(/type\.is\.null,type\.neq\.show/.test(pool), "getRadioPool leaves recorded shows out of the shuffle");

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
