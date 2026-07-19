import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookieStorageAdapter } from "@/lib/supabaseCookieStorage";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Public (browser) client - anon key, respects Row Level Security.
// Created lazily so that importing this module does NOT construct a client at
// load time. @supabase/supabase-js throws "supabaseUrl is required" when the
// env vars are missing, which used to break `next build` page-data collection
// for any route importing from here. The Proxy defers creation until the first
// property access (e.g. supabase.from / supabase.auth), which only happens at
// runtime when env vars are present.
// The Supabase project ref is embedded in the SDK's default localStorage key
// (`sb-<ref>-auth-token`). Derive it from the URL so we can migrate an existing
// signed-in session out of localStorage and into the new cookie store ONCE,
// sparing already-logged-in users a forced re-login after this change ships.
function migrateLegacyLocalStorageSession(): void {
try {
if (typeof window === "undefined" || !window.localStorage) return;
// Already migrated? (cookie present) then do nothing.
if (cookieStorageAdapter.getItem("melori-auth") !== null) return;
const ref = new URL(supabaseUrl).hostname.split(".")[0];
if (!ref) return;
const legacyKey = `sb-${ref}-auth-token`;
const legacyValue = window.localStorage.getItem(legacyKey);
if (legacyValue) {
cookieStorageAdapter.setItem("melori-auth", legacyValue);
window.localStorage.removeItem(legacyKey);
}
} catch {
/* best-effort: a failed migration just means a one-time re-login */
}
}

let _browserClient: SupabaseClient | null = null;
function getBrowserClient(): SupabaseClient {
if (!_browserClient) {
if (typeof document !== "undefined") migrateLegacyLocalStorageSession();
_browserClient = createClient(supabaseUrl, supabaseAnonKey, {
auth: {
flowType: "pkce",
autoRefreshToken: true,
persistSession: true,
detectSessionInUrl: true,
// Persist the PKCE code_verifier + session in a COOKIE instead of
// localStorage. Cookies ride along with the OAuth redirect back from
// Google regardless of which storage partition the callback opens in,
// which eliminates the recurring "PKCE code verifier not found in
// storage" failure on in-app webviews / private tabs / cross-browser
// handoffs. See src/lib/supabaseCookieStorage.ts for the full rationale.
// Guarded to the browser: on the server there is no `document`, and this
// client is only ever used client-side anyway.
...(typeof document !== "undefined"
? { storage: cookieStorageAdapter, storageKey: "melori-auth" }
: {}),
},
});
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
//
// Fail loudly when misconfigured. Previously this fell back to an empty key,
// producing an unprivileged client that silently failed every write (RLS
// rejected the insert) — which is how studio_tracks ended up empty. Throwing
// surfaces the misconfiguration as a 500 instead of a silent no-op.
export function createServiceClient(): SupabaseClient {
const url = supabaseUrl || process.env.SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !serviceKey) {
console.error(
"createServiceClient: missing Supabase URL or SUPABASE_SERVICE_ROLE_KEY",
);
throw new Error("Supabase service client is not configured");
}
return createClient(url, serviceKey, {
auth: { persistSession: false },
});
}
