import { supabase } from "@/lib/supabase";

// Client helpers to forward the Supabase access token to our own route handlers.
// Supabase auth is localStorage-based here, so the server can only identify the
// caller via an Authorization header we attach ourselves.
//
// getSession() returns whatever is cached in localStorage, which may be an
// EXPIRED access token if autoRefreshToken has not fired yet (e.g. right after
// a tab regains focus). The server rejects an expired token, so the caller is
// silently treated as logged-out -> paid members and admins get downgraded to
// the 30s sample. To prevent that, we proactively refresh when the token is
// missing or within a small skew window of expiry before attaching it.

const EXPIRY_SKEW_SECONDS = 60;

async function getFreshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.access_token) return null;

  const expiresAt = session.expires_at; // unix seconds, may be undefined
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isStale =
    typeof expiresAt === "number" && expiresAt - nowSeconds <= EXPIRY_SKEW_SECONDS;

  if (!isStale) return session.access_token;

  // Token is expired or about to expire: refresh once. Fall back to the
  // existing token if the refresh fails so we never regress current behaviour.
  const { data: refreshed } = await supabase.auth.refreshSession();
  return refreshed.session?.access_token ?? session.access_token;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getFreshAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = { ...(init.headers ?? {}), ...(await authHeaders()) };
  return fetch(input, { ...init, headers });
}
