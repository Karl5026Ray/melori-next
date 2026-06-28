import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase admin client. Uses the service role key, which bypasses
// Row Level Security. This module must NEVER be imported into client components —
// SUPABASE_SERVICE_ROLE_KEY is not a NEXT_PUBLIC_ var and stays on the server.
//
// IMPORTANT (stale-data fix): the project URL is resolved from a server-only
// runtime variable FIRST (`SUPABASE_URL`), falling back to the public one.
// `NEXT_PUBLIC_*` values are inlined into the bundle at *build* time, so a build
// produced while that value was wrong/stale would stay frozen to the wrong
// project across redeploys. A server-only var is read from the function's
// runtime environment on every cold start, so it always reflects the current
// Vercel configuration. A fresh client is created per request — no module-level
// memoization — so we never reuse a client bound to a stale value.
export function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin client is not configured");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
