import type { SupabaseClient } from "@supabase/supabase-js";

// Melori Connect matching logic.
//
// "Harmony Score" is an EXPLAINABLE music-affinity score (0-100) built from
// signals Melori already owns: the social follow graph (who you both follow)
// and, where resolvable, followed artists. It is intentionally defensive — it
// NEVER throws on missing/optional data, degrading gracefully to a low score
// with an honest explanation instead. Listening-behavior / genre-vector
// personalization is a P2 add (see dating_music_affinity_cache).

export interface HarmonyResult {
  score: number; // 0-100
  explanation: string[]; // human-readable reasons, e.g. "3 mutual follows"
}

export interface TasteSignals {
  // Set of profile ids this user follows (the follow graph).
  follows: Set<string>;
  // Set of artist ids/slugs this user follows, when resolvable.
  artists: Set<string>;
  // Optional top genres (from the affinity cache), lower-cased.
  genres: Set<string>;
}

export interface DatingCandidate {
  profile_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  age: number | null;
  intent: string;
  shown_gender: string | null;
  bio_override: string | null;
  verified: boolean;
  photo_url: string | null;
  prompt_preview: { text: string; answer: string } | null;
  harmony: HarmonyResult;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function overlapList(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const v of a) if (b.has(v)) out.push(v);
  return out;
}

// Compute age in whole years from a date-of-birth string (YYYY-MM-DD).
// Returns null on unparseable input.
export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

// Explainable Harmony Score. Weighs shared artists most (the differentiator),
// then shared genres, then the community-graph signal (mutual follows).
export function computeHarmonyScore(
  a: TasteSignals,
  b: TasteSignals,
  opts?: {
    // Optional id->label maps so explanations can name real artists/people
    // instead of opaque ids. Missing labels fall back to counts.
    artistLabels?: Map<string, string>;
  },
): HarmonyResult {
  const explanation: string[] = [];

  const sharedArtists = overlapList(a.artists, b.artists);
  const sharedGenres = overlapList(a.genres, b.genres);
  const sharedFollows = overlapList(a.follows, b.follows);

  // If the combined universe across every dimension is empty, there is nothing
  // to compare — return a low-confidence baseline rather than NaN / a fake 0%.
  const unionSize =
    a.artists.size + b.artists.size + a.genres.size + b.genres.size + a.follows.size + b.follows.size;
  if (unionSize === 0) {
    return { score: 0, explanation: ["Not enough shared taste yet"] };
  }

  // Artist-follows and people-follows are weighted SEPARATELY so "we both follow
  // the same popular account" (people) can never masquerade as musical affinity
  // (artists); artists dominate, genres and the community graph fill in.
  const artistSim = jaccard(a.artists, b.artists);
  const genreSim = jaccard(a.genres, b.genres);
  const followSim = jaccard(a.follows, b.follows);
  const blended = 0.55 * artistSim + 0.25 * genreSim + 0.2 * followSim;

  // Minimum-evidence confidence damp: a single shared item can't fake a high
  // score. Below MIN_EVIDENCE distinct shared signals the score is scaled down
  // proportionally, so a lone shared follow yields a modest number, not 100%.
  const MIN_EVIDENCE = 3;
  const sharedTotal = sharedArtists.length + sharedGenres.length + sharedFollows.length;
  const confidence = Math.min(1, sharedTotal / MIN_EVIDENCE);

  const score = Math.max(0, Math.min(100, Math.round(blended * confidence * 100)));

  if (sharedArtists.length > 0) {
    const labels = sharedArtists
      .slice(0, 3)
      .map((id) => opts?.artistLabels?.get(id) ?? id);
    const named = labels.filter((l) => l && !/^[0-9a-f-]{16,}$/i.test(l));
    if (named.length > 0) {
      explanation.push(
        `${sharedArtists.length} shared artist${sharedArtists.length > 1 ? "s" : ""}: ${named.join(", ")}`,
      );
    } else {
      explanation.push(
        `${sharedArtists.length} shared favorite artist${sharedArtists.length > 1 ? "s" : ""}`,
      );
    }
  }
  if (sharedGenres.length > 0) {
    explanation.push(
      `${sharedGenres.length} shared genre${sharedGenres.length > 1 ? "s" : ""}: ${sharedGenres.slice(0, 3).join(", ")}`,
    );
  }
  if (sharedFollows.length > 0) {
    explanation.push(
      `${sharedFollows.length} mutual follow${sharedFollows.length > 1 ? "s" : ""}`,
    );
  }
  if (explanation.length === 0) {
    explanation.push("New on Melori — discover your shared taste");
  } else if (confidence < 1) {
    // Be honest that the signal is thin so the percentage isn't over-read.
    explanation.push("Limited shared signal so far");
  }

  return { score, explanation };
}

// Load a user's taste signals defensively. Any query failure degrades to an
// empty signal set rather than throwing.
export async function loadTasteSignals(
  supabase: SupabaseClient,
  userId: string,
): Promise<TasteSignals> {
  const follows = new Set<string>();
  const artists = new Set<string>();
  const genres = new Set<string>();

  try {
    const { data } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", userId)
      .limit(1000);
    for (const row of data ?? []) {
      const id = (row as { following_id?: string }).following_id;
      if (id) follows.add(id);
    }
  } catch {
    /* thin signal is fine */
  }

  // Followed artists, if a follow-artists table exists. We probe defensively
  // and swallow the "relation does not exist" error so this stays optional.
  try {
    const { data } = await supabase
      .from("artist_follows")
      .select("artist_id")
      .eq("user_id", userId)
      .limit(1000);
    for (const row of data ?? []) {
      const id = (row as { artist_id?: string | number }).artist_id;
      if (id != null) artists.add(String(id));
    }
  } catch {
    /* artist_follows may not exist in MVP — ignore */
  }

  // Precomputed taste (top artists/genres) from the affinity cache, if present.
  try {
    const { data } = await supabase
      .from("dating_music_affinity_cache")
      .select("top_artists, top_genres")
      .eq("profile_id", userId)
      .maybeSingle();
    const ta = (data as { top_artists?: unknown })?.top_artists;
    const tg = (data as { top_genres?: unknown })?.top_genres;
    if (Array.isArray(ta)) for (const v of ta) if (v != null) artists.add(String(v));
    if (Array.isArray(tg)) for (const v of tg) if (v != null) genres.add(String(v).toLowerCase());
  } catch {
    /* optional */
  }

  return { follows, artists, genres };
}

export interface BatchOptions {
  limit?: number; // hard cap, default 8
}

// Build the daily batch of 3-8 candidates for a user. Hard filters run FIRST
// (active, intent compatible, gender/seeking, age range, not self, not already
// acted on, not blocked either direction), then rank by Harmony Score.
//
// Fully defensive: any query failure returns an empty batch rather than
// throwing, so the daily-matches surface degrades to an empty state.
export async function buildDailyBatch(
  supabase: SupabaseClient,
  userId: string,
  opts: BatchOptions = {},
): Promise<DatingCandidate[]> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 8);

  try {
    // My dating profile drives the hard filters.
    const { data: me } = await supabase
      .from("dating_profiles")
      .select(
        "profile_id, is_active, intent, shown_gender, seeking_gender, age_min, age_max",
      )
      .eq("profile_id", userId)
      .maybeSingle();
    if (!me || !(me as { is_active?: boolean }).is_active) return [];

    const myIntent = (me as { intent?: string }).intent ?? "either";
    const seeking = ((me as { seeking_gender?: string[] }).seeking_gender ?? []).filter(
      Boolean,
    );
    const ageMin = (me as { age_min?: number }).age_min ?? 18;
    const ageMax = (me as { age_max?: number }).age_max ?? 99;

    // Everyone I've already acted on (exclude from batch).
    const actedOn = new Set<string>();
    {
      const { data } = await supabase
        .from("dating_actions")
        .select("target_id")
        .eq("actor_id", userId);
      for (const row of data ?? []) {
        const id = (row as { target_id?: string }).target_id;
        if (id) actedOn.add(id);
      }
    }

    // Blocks in either direction.
    const blocked = new Set<string>();
    {
      const { data } = await supabase
        .from("member_blocks")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
      for (const row of data ?? []) {
        const r = row as { blocker_id?: string; blocked_id?: string };
        if (r.blocker_id && r.blocker_id !== userId) blocked.add(r.blocker_id);
        if (r.blocked_id && r.blocked_id !== userId) blocked.add(r.blocked_id);
      }
    }

    // Candidate pool: active dating profiles other than me.
    const { data: pool } = await supabase
      .from("dating_profiles")
      .select(
        "profile_id, is_active, dob, intent, shown_gender, seeking_gender, bio_override, verified",
      )
      .eq("is_active", true)
      .neq("profile_id", userId)
      .limit(200);

    const candidatesRaw = (pool ?? []).filter((row) => {
      const r = row as {
        profile_id: string;
        dob?: string;
        intent?: string;
        shown_gender?: string | null;
        seeking_gender?: string[] | null;
      };
      if (actedOn.has(r.profile_id) || blocked.has(r.profile_id)) return false;

      // Intent compatibility: 'either' is compatible with anything; otherwise
      // both must want the same non-either intent (or one side is 'either').
      const theirIntent = r.intent ?? "either";
      if (
        myIntent !== "either" &&
        theirIntent !== "either" &&
        myIntent !== theirIntent
      ) {
        return false;
      }

      // Age range filter.
      const age = ageFromDob(r.dob);
      if (age == null || age < 18) return false;
      if (age < ageMin || age > ageMax) return false;

      // Gender/seeking: if I specified who I'm seeking, their shown_gender must
      // be in my list. Empty seeking = open to all.
      if (seeking.length > 0) {
        const sg = r.shown_gender;
        if (!sg || !seeking.includes(sg)) return false;
      }
      // Mutual: if they specified seeking, my shown gender should match theirs.
      const theirSeeking = (r.seeking_gender ?? []).filter(Boolean);
      if (theirSeeking.length > 0) {
        const myShown = (me as { shown_gender?: string | null }).shown_gender;
        if (!myShown || !theirSeeking.includes(myShown)) return false;
      }
      return true;
    });

    if (candidatesRaw.length === 0) return [];

    const myTaste = await loadTasteSignals(supabase, userId);
    const ids = candidatesRaw.map((r) => (r as { profile_id: string }).profile_id);

    // Batch-load presentation data: profiles, first photo, one prompt answer.
    const [profilesRes, photosRes, promptsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, display_name, full_name, avatar_url, status")
        .in("id", ids),
      supabase
        .from("dating_profile_photos")
        .select("profile_id, image_url, sort_order")
        .in("profile_id", ids)
        .order("sort_order", { ascending: true }),
      supabase
        .from("dating_profile_prompts")
        .select("profile_id, prompt_id, answer, sort_order")
        .in("profile_id", ids)
        .order("sort_order", { ascending: true }),
    ]);

    const profileMap = new Map<string, any>();
    for (const p of profilesRes.data ?? []) profileMap.set((p as { id: string }).id, p);

    const firstPhoto = new Map<string, string>();
    for (const ph of photosRes.data ?? []) {
      const r = ph as { profile_id: string; image_url: string };
      if (!firstPhoto.has(r.profile_id)) firstPhoto.set(r.profile_id, r.image_url);
    }

    const firstPromptId = new Map<string, { prompt_id: number; answer: string }>();
    for (const pr of promptsRes.data ?? []) {
      const r = pr as { profile_id: string; prompt_id: number; answer: string };
      if (!firstPromptId.has(r.profile_id))
        firstPromptId.set(r.profile_id, { prompt_id: r.prompt_id, answer: r.answer });
    }

    // Resolve prompt texts for the previews we actually need.
    const promptTextMap = new Map<number, string>();
    const neededPromptIds = Array.from(
      new Set(Array.from(firstPromptId.values()).map((v) => v.prompt_id)),
    );
    if (neededPromptIds.length > 0) {
      const { data } = await supabase
        .from("dating_prompts")
        .select("id, text")
        .in("id", neededPromptIds);
      for (const row of data ?? []) {
        const r = row as { id: number; text: string };
        promptTextMap.set(r.id, r.text);
      }
    }

    const out: DatingCandidate[] = [];
    for (const row of candidatesRaw) {
      const r = row as {
        profile_id: string;
        dob?: string;
        intent?: string;
        shown_gender?: string | null;
        bio_override?: string | null;
        verified?: boolean;
      };
      const prof = profileMap.get(r.profile_id);
      // Skip anyone whose base account isn't active.
      if (prof && prof.status && prof.status !== "active") continue;

      const theirTaste = await loadTasteSignals(supabase, r.profile_id);
      const harmony = computeHarmonyScore(myTaste, theirTaste);

      const promptRef = firstPromptId.get(r.profile_id);
      const promptPreview = promptRef
        ? {
            text: promptTextMap.get(promptRef.prompt_id) ?? "Prompt",
            answer: promptRef.answer,
          }
        : null;

      out.push({
        profile_id: r.profile_id,
        username: prof?.username ?? null,
        display_name: prof?.display_name ?? prof?.full_name ?? prof?.username ?? null,
        avatar_url: prof?.avatar_url ?? null,
        age: ageFromDob(r.dob),
        intent: r.intent ?? "either",
        shown_gender: r.shown_gender ?? null,
        bio_override: r.bio_override ?? null,
        verified: !!r.verified,
        photo_url: firstPhoto.get(r.profile_id) ?? prof?.avatar_url ?? null,
        prompt_preview: promptPreview,
        harmony,
      });
    }

    out.sort((x, y) => y.harmony.score - x.harmony.score);
    return out.slice(0, limit);
  } catch (err) {
    console.error("buildDailyBatch failed", err);
    return [];
  }
}
