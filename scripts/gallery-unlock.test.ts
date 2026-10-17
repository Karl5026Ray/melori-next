/* eslint-disable no-console */
// scripts/gallery-unlock.test.ts
//
// Pins the 2026-10-17 fix for the gallery password bypass: the unlock cookie
// must be a server-signed token, never password_hash itself (which used to be
// readable with the public anon key).
//
// Run:  npx tsx scripts/gallery-unlock.test.ts

import fs from "node:fs";
import path from "node:path";

process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-secret-for-unit-test-only";

import { galleryUnlockToken, isGalleryUnlocked, sha256Hex } from "@/lib/gallery-auth";

let checks = 0;
let failures = 0;
const check = (label: string, cond: boolean) => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
  }
};
const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const hash = sha256Hex("hunter2");
const token = galleryUnlockToken("wedding-abc", hash);

check("token is not the password hash", token !== hash);
check("correct token unlocks", isGalleryUnlocked(token, "wedding-abc", hash));
check("the raw hash does NOT unlock (the old bypass)", !isGalleryUnlocked(hash, "wedding-abc", hash));
check("token for another gallery does not unlock", !isGalleryUnlocked(galleryUnlockToken("other", hash), "wedding-abc", hash));
check("changing the password invalidates the token", !isGalleryUnlocked(token, "wedding-abc", sha256Hex("new")));
check("missing cookie does not unlock", !isGalleryUnlocked(undefined, "wedding-abc", hash));
check("garbage does not unlock", !isGalleryUnlocked("x", "wedding-abc", hash));

const verify = read("src/app/api/gallery/verify/route.ts");
check("verify route sets the signed token", verify.includes("galleryUnlockToken(slug, gallery.password_hash)"));
const viewer = read("src/app/gallery/[slug]/page.tsx");
check("viewer checks with isGalleryUnlocked", viewer.includes("isGalleryUnlocked(cookieVal, slug, gallery.password_hash)"));
check("viewer no longer compares the cookie to the hash", !viewer.includes("cookieVal !== gallery.password_hash"));

const sql = read("supabase/migrations/099_gallery_password_lockdown.sql");
check("migration revokes table-wide select", sql.includes("revoke select on public.photo_galleries from anon, authenticated"));
check("column grant omits password_hash", !/grant select \([^)]*password_hash/.test(sql));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
