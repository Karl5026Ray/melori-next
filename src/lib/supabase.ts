import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Public (browser) client — anon key, respects Row Level Security.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-only client — service role key, bypasses RLS.
// Per spec: all DB queries run server-side with the service role key.
export function createServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}
