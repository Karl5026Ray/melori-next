import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Server-only helper: idempotently ensure a `public.artists` row exists for a
// profile once that profile becomes an artist.
//
// A profile becomes an artist in three places (welcome/complete, the members
// Stripe webhook, and admin role grants) but no `artists` row was created, so
// dashboard/studio stats — which resolve the current user via
// `artists.profile_id` — stayed empty ("profile isn't linked to an artist row
// yet"). Centralizing creation here means every entry point grants the same
// state, and the dashboard/studio can self-heal existing artists on load.
//
// Uses the service-role client (bypasses RLS). NEVER import into a client
// component. Safe to call repeatedly: it returns the existing row when one is
// already linked and tolerates the create race between a check and an insert.

export interface EnsureArtistRowOptions {
  displayName?: string | null;
  username?: string | null;
}

export interface EnsureArtistRowResult {
  id: number | null;
  created: boolean;
  error?: string;
}

function slugify(raw: string | null | undefined): string {
  return (
    (raw ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "artist"
  );
}

// Build a slug that isn't already taken. `artists.slug` is UNIQUE, so we probe
// the base slug, then a profile-id–suffixed variant, then a random suffix.
async function uniqueSlug(
  supabase: SupabaseClient,
  seed: string | null | undefined,
  profileId: string,
): Promise<string> {
  const base = slugify(seed);
  const candidates = [base, `${base}-${profileId.slice(0, 6)}`];
  for (const candidate of candidates) {
    const { data } = await supabase
      .from("artists")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${profileId.slice(0, 6)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function ensureArtistRow(
  profileId: string,
  opts: EnsureArtistRowOptions = {},
  client?: SupabaseClient,
): Promise<EnsureArtistRowResult> {
  if (!profileId) {
    return { id: null, created: false, error: "Missing profile id" };
  }
  const supabase = client ?? getSupabaseAdmin();

  // Already linked? Nothing to do.
  const existing = await supabase
    .from("artists")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existing.data?.id) {
    return { id: existing.data.id as number, created: false };
  }

  // Resolve a friendly name / handle, falling back to the profile row when the
  // caller didn't supply them.
  let displayName = opts.displayName ?? null;
  let username = opts.username ?? null;
  if (!displayName || !username) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, full_name, username")
      .eq("id", profileId)
      .maybeSingle();
    const p = profile as
      | { display_name?: string | null; full_name?: string | null; username?: string | null }
      | null;
    displayName = displayName || p?.display_name || p?.full_name || null;
    username = username || p?.username || null;
  }

  const seedName = (displayName || username || "MELORI Artist").trim() || "MELORI Artist";
  const slug = await uniqueSlug(supabase, username || seedName, profileId);

  const insert = await supabase
    .from("artists")
    .insert({
      name: seedName,
      slug,
      profile_id: profileId,
      is_published: false,
    })
    .select("id")
    .maybeSingle();

  if (insert.error || !insert.data?.id) {
    // Likely a race: a concurrent call created the row between our check and
    // insert. Re-read before treating this as a failure.
    const retry = await supabase
      .from("artists")
      .select("id")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (retry.data?.id) {
      return { id: retry.data.id as number, created: false };
    }
    console.error("ensureArtistRow insert error:", insert.error);
    return {
      id: null,
      created: false,
      error: insert.error?.message ?? "Could not create artist row",
    };
  }

  return { id: insert.data.id as number, created: true };
}
