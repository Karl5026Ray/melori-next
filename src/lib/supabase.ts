import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Public (browser) client - anon key, respects Row Level Security.
// Created lazily so that importing this module does NOT construct a client at
// load time. @supabase/supabase-js throws "supabaseUrl is required" when the
// env vars are missing, which used to break `next build` page-data collection
// for any route importing from here. The Proxy defers creation until the first
// property access (e.g. supabase.from / supabase.auth), which only happens at
// runtime when env vars are present.
let _browserClient: SupabaseClient | null = null;
function getBrowserClient(): SupabaseClient {
if (!_browserClient) {
_browserClient = createClient(supabaseUrl, supabaseAnonKey);
}
return _browserClient;
}

export const supabase = new Proxy({} as SupabaseClient, {
get(_target, prop, receiver) {
const client = getBrowserClient();
const value = Reflect.get(client as object, prop, receiver);
return typeof value === "function" ? value.bind(client) : value;
},
});

// Server-only client - service role key, bypasses RLS.
// Per spec: all DB queries run server-side with the service role key.
// Already lazy (function), so it is only constructed when actually called.
export function createServiceClient(): SupabaseClient {
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
return createClient(supabaseUrl, serviceKey, {
auth: { persistSession: false },
});
}
