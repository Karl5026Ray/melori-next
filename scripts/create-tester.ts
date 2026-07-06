/**
 * One-off: create a COMPED ARTIST tester account and email a set-password link.
 *
 * Target: chidreams28@gmail.com
 *   - auth user (email confirmed, random temp password)
 *   - profiles row: role=artist, membership active/artist, is_comp=true,
 *     billing_exempt=true  (full artist access, billing exempt)
 *   - Supabase Admin generateLink (recovery) -> redirects to /reset-password
 *   - emailed via Resend (subject: "Set up your Melori artist account")
 *
 * Run from the repo root with the real env (service role key etc.):
 *   npx tsx scripts/create-tester.ts
 *
 * Reads env from process.env, and if present, from a local .env.local file so
 * it works the same way `next dev` does. NEVER commit .env.local.
 *
 * Required env:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   NEXT_PUBLIC_APP_URL (optional; defaults to https://melorimusic.org)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sendSetPasswordEmail } from "../src/lib/email";

const TARGET_EMAIL = "chidreams28@gmail.com";
const DISPLAY_NAME = "Chi";

function loadDotEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on the ambient environment */
  }
}

function randomPassword(): string {
  return `Mlr-${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}-${Date.now().toString(36)}`;
}

async function findUserByEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find(
      (u: { id: string; email?: string | null }) =>
        (u.email ?? "").toLowerCase() === target,
    );
    if (match) return { id: match.id, email: match.email ?? target };
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  loadDotEnvLocal();

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://melorimusic.org";

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // 1) create-or-find the auth user
  let user = await findUserByEmail(admin, TARGET_EMAIL);
  if (user) {
    console.log(`Auth user already exists: ${user.id}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: TARGET_EMAIL,
      password: randomPassword(),
      email_confirm: true,
      user_metadata: { display_name: DISPLAY_NAME, role: "artist" },
    });
    if (error || !data?.user) {
      throw new Error(`createUser failed: ${error?.message ?? "unknown"}`);
    }
    user = { id: data.user.id, email: data.user.email ?? TARGET_EMAIL };
    console.log(`Created auth user: ${user.id}`);
  }

  // 2) upsert the comped-artist profile
  const profileRow = {
    id: user.id,
    role: "artist",
    membership_status: "active",
    membership_tier: "artist",
    is_comp: true,
    billing_exempt: true,
    display_name: DISPLAY_NAME,
    full_name: DISPLAY_NAME,
    membership_updated_at: new Date().toISOString(),
  };
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(profileRow, { onConflict: "id" });
  if (profileErr) {
    throw new Error(`profile upsert failed: ${profileErr.message}`);
  }
  console.log("Profile upserted (role=artist, is_comp=true, billing_exempt=true)");

  // 3) generate a set-password (recovery) link -> /reset-password
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: TARGET_EMAIL,
    options: { redirectTo: `${appUrl}/reset-password` },
  });
  const link = linkData?.properties?.action_link;
  if (linkErr || !link) {
    throw new Error(`generateLink failed: ${linkErr?.message ?? "no link"}`);
  }
  console.log(`Set-password link: ${link}`);

  // 4) email it via Resend
  const resendId = await sendSetPasswordEmail({
    to: TARGET_EMAIL,
    link,
    subject: "Set up your Melori artist account",
    heading: "Welcome to Melori",
    intro:
      "Your Melori artist account is ready. Set your password to sign in and start using the studio.",
    buttonLabel: "Set your password",
  });
  console.log(`Email sent via Resend. id=${resendId}`);

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ userId: user.id, email: TARGET_EMAIL, resendId, link }, null, 2));
}

main().catch((err) => {
  console.error("create-tester failed:", err);
  process.exit(1);
});
