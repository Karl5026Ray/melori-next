import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase admin client. Uses the service role key, which bypasses
// Row Level Security. This module must NEVER be imported into client components —
// SUPABASE_SERVICE_ROLE_KEY is not a NEXT_PUBLIC_ var and stays on the server.
//
// The client is created lazily (not at module load) so that `next build` can
// collect page data without the Supabase env vars being present.
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin client is not configured");
  }

  client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}
