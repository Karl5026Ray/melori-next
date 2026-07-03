import { supabase } from "@/lib/supabase";

// Client helpers to forward the Supabase access token to our own route handlers.
// Supabase auth is localStorage-based here, so the server can only identify the
// caller via an Authorization header we attach ourselves.

export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = { ...(init.headers ?? {}), ...(await authHeaders()) };
  return fetch(input, { ...init, headers });
}
