// Concert production readiness — pure evaluation, no I/O.
//
// The Concert live battle stage has two hard external dependencies that are
// invisible at build time and only fail at the moment a real battle goes live:
//
//   1. LiveKit server credentials. Without them /api/livekit-token cannot mint
//      a join token, so both competitors sit on "Waiting for their camera"
//      forever with no visible error on the stage itself.
//   2. Migration 066 (instrument gift catalog + the concert_battle_gift_totals
//      aggregate). Without the rows the gift tray is empty; without the
//      function the battle read degrades every score to zero, which looks
//      exactly like "nobody has gifted yet".
//
// Both failure modes are silent-by-design at runtime -- the stage degrades
// gracefully rather than crashing -- which is precisely why they need an
// explicit preflight. This module holds the decision logic so it can be unit
// tested without a database, a network, or a populated environment;
// scripts/verify-concert-config.ts supplies the real probe results.

/** One thing that must be true before a live battle works. */
export type ConcertCheckId =
  | "livekit_url"
  | "livekit_api_key"
  | "livekit_api_secret"
  | "livekit_reachable"
  | "cron_secret"
  | "gift_catalog"
  | "score_function"
  | "score_function_locked"
  | "gift_send_index";

export type ConcertCheckSeverity = "required" | "recommended";

export type ConcertCheckStatus = "pass" | "fail" | "unknown";

export type ConcertCheck = {
  id: ConcertCheckId;
  label: string;
  severity: ConcertCheckSeverity;
  status: ConcertCheckStatus;
  /** Present on anything other than a pass: what to actually do about it. */
  detail: string;
};

/** The five instrument gift slugs the battle tray expects, in tray order. */
export const CONCERT_REQUIRED_GIFT_SLUGS = [
  "battle_guitar",
  "battle_piano",
  "battle_drum",
  "battle_violin",
  "battle_saxophone",
] as const;

/**
 * Environment values as read from process.env. Deliberately typed as
 * possibly-undefined strings: this module never reads process.env itself, so a
 * test can describe any environment without mutating global state.
 */
export type ConcertEnvInput = {
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  CRON_SECRET?: string;
};

/**
 * What the database probe found. `null` means "could not be determined"
 * (no service-role key, connection refused) and is reported as unknown rather
 * than as a pass or a failure -- an unreachable database must never read as
 * "ready".
 */
export type ConcertDbInput = {
  /** Slugs found in public.gifts with active = true. */
  activeGiftSlugs: readonly string[] | null;
  /** Whether public.concert_battle_gift_totals(uuid) exists. */
  scoreFunctionExists: boolean | null;
  /** Roles holding EXECUTE on that function, excluding the table owner. */
  scoreFunctionGrantees: readonly string[] | null;
  /** Whether gift_sends_space_target_idx exists on public.gift_sends. */
  giftSendIndexExists: boolean | null;
};

/**
 * Result of actually calling LiveKit with the configured credentials. Presence
 * of the three variables proves nothing about whether they are *valid* -- a
 * rotated secret still looks perfectly configured. `null` means the live probe
 * was skipped.
 */
export type ConcertLiveKitProbe = {
  ok: boolean;
  /** Error text when ok is false; safe to print (never contains the secret). */
  error?: string;
} | null;

/** A value counts as configured only if it is a non-blank string. */
function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// Placeholders are worse than a missing value: a missing value fails loudly on
// first use, while "changeme" produces an authentication error that reads like
// a LiveKit outage. Treat anything obviously fake as unset.
const PLACEHOLDER_PATTERN = /^(changeme|placeholder|todo|your[-_ ]?|xxx+|<.*>|test|example)/i;

function isPlaceholder(value: string | undefined): boolean {
  if (!isSet(value)) return false;
  return PLACEHOLDER_PATTERN.test(value!.trim());
}

function envCheck(
  id: ConcertCheckId,
  label: string,
  name: string,
  value: string | undefined,
  severity: ConcertCheckSeverity,
  remediation: string,
): ConcertCheck {
  if (!isSet(value)) {
    return { id, label, severity, status: "fail", detail: `${name} is not set. ${remediation}` };
  }
  if (isPlaceholder(value)) {
    return {
      id,
      label,
      severity,
      status: "fail",
      detail: `${name} looks like a placeholder, not a real credential. ${remediation}`,
    };
  }
  return { id, label, severity, status: "pass", detail: "" };
}

/** LiveKit's server URL must be a websocket URL; an https:// paste is a common slip. */
function livekitUrlCheck(value: string | undefined): ConcertCheck {
  const base = envCheck(
    "livekit_url",
    "LiveKit server URL",
    "LIVEKIT_URL",
    value,
    "required",
    "Copy the wss:// project URL from the LiveKit Cloud dashboard into the Vercel environment.",
  );
  if (base.status !== "pass") return base;
  const trimmed = (value ?? "").trim();
  if (!/^wss?:\/\//i.test(trimmed)) {
    return {
      ...base,
      status: "fail",
      detail: `LIVEKIT_URL must be a websocket URL starting with wss:// (got "${trimmed.slice(0, 12)}…"). The LiveKit Cloud dashboard shows it next to the project name.`,
    };
  }
  return base;
}

function livekitReachableCheck(probe: ConcertLiveKitProbe): ConcertCheck {
  const id: ConcertCheckId = "livekit_reachable";
  const label = "LiveKit credentials accepted";
  if (probe === null) {
    return {
      id,
      label,
      severity: "recommended",
      status: "unknown",
      detail: "Live probe skipped. Re-run with --live to verify the credentials actually authenticate.",
    };
  }
  if (!probe.ok) {
    return {
      id,
      label,
      // A rejected credential is exactly the silent failure this preflight
      // exists to catch, so once probed it is blocking, not advisory.
      severity: "required",
      status: "fail",
      detail: `LiveKit rejected the configured credentials: ${probe.error ?? "unknown error"}. Rotate the key in LiveKit Cloud and update LIVEKIT_API_KEY and LIVEKIT_API_SECRET together.`,
    };
  }
  return { id, label, severity: "recommended", status: "pass", detail: "" };
}

export function evaluateConcertReadiness(
  env: ConcertEnvInput,
  db: ConcertDbInput,
  livekit: ConcertLiveKitProbe = null,
): { checks: ConcertCheck[]; ready: boolean; blocking: ConcertCheck[] } {
  const checks: ConcertCheck[] = [
    livekitUrlCheck(env.LIVEKIT_URL),
    envCheck(
      "livekit_api_key",
      "LiveKit API key",
      "LIVEKIT_API_KEY",
      env.LIVEKIT_API_KEY,
      "required",
      "Create a key in LiveKit Cloud → Settings → Keys and set it in Vercel (Production and Preview).",
    ),
    envCheck(
      "livekit_api_secret",
      "LiveKit API secret",
      "LIVEKIT_API_SECRET",
      env.LIVEKIT_API_SECRET,
      "required",
      "The secret is shown only once, at key creation. If it was lost, create a new key and update both variables together.",
    ),
    // REQUIRED since the round lifecycle shipped. /api/cron/concert-battle-rounds
    // is the backstop that finalizes an expired round, opens the intermission,
    // starts the next round, and completes the battle. Competitors' clients
    // normally transition instantly, but if both drop, this cron is the only
    // thing that moves the battle — and without the secret it answers 403, so a
    // round can hang at 00:00. It also gates the presence/cleanup routes.
    envCheck(
      "cron_secret",
      "Cron secret",
      "CRON_SECRET",
      env.CRON_SECRET,
      "required",
      "Set any long random value in Vercel; /api/cron/concert-battle-rounds and every other scheduled route in vercel.json refuse to run without it, which can leave a round stuck at 00:00.",
    ),
    livekitReachableCheck(livekit),
    giftCatalogCheck(db.activeGiftSlugs),
    scoreFunctionCheck(db.scoreFunctionExists),
    scoreFunctionLockCheck(db.scoreFunctionGrantees),
    giftSendIndexCheck(db.giftSendIndexExists),
  ];

  // "unknown" blocks too. A probe that could not run is not evidence of health.
  const blocking = checks.filter((c) => c.severity === "required" && c.status !== "pass");
  return { checks, ready: blocking.length === 0, blocking };
}

function giftCatalogCheck(slugs: readonly string[] | null): ConcertCheck {
  const id: ConcertCheckId = "gift_catalog";
  const label = "Instrument gift catalog";
  if (slugs === null) {
    return {
      id,
      label,
      severity: "required",
      status: "unknown",
      detail:
        "Could not read public.gifts. Set SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL to let this check run.",
    };
  }
  const present = new Set(slugs);
  const missing = CONCERT_REQUIRED_GIFT_SLUGS.filter((slug) => !present.has(slug));
  if (missing.length > 0) {
    return {
      id,
      label,
      severity: "required",
      status: "fail",
      detail: `Missing or inactive gift ${missing.length === 1 ? "slug" : "slugs"}: ${missing.join(", ")}. Apply supabase/migrations/066_concert_instrument_gifts_and_scores.sql.`,
    };
  }
  return { id, label, severity: "required", status: "pass", detail: "" };
}

function scoreFunctionCheck(exists: boolean | null): ConcertCheck {
  const id: ConcertCheckId = "score_function";
  const label = "concert_battle_gift_totals()";
  if (exists === null) {
    return {
      id,
      label,
      severity: "required",
      status: "unknown",
      detail: "Could not inspect pg_proc. Set SUPABASE_SERVICE_ROLE_KEY to let this check run.",
    };
  }
  if (!exists) {
    return {
      id,
      label,
      severity: "required",
      status: "fail",
      detail:
        "public.concert_battle_gift_totals(uuid) does not exist, so every battle score reads as zero. Apply migration 066.",
    };
  }
  return { id, label, severity: "required", status: "pass", detail: "" };
}

/**
 * The score aggregate is SECURITY DEFINER, so an accidental grant to anon or
 * authenticated would let any signed-in client read gift totals for any space
 * directly, bypassing the server routes. Migration 062 established that
 * lockdown for the Concert domain; this check keeps it from drifting.
 */
function scoreFunctionLockCheck(grantees: readonly string[] | null): ConcertCheck {
  const id: ConcertCheckId = "score_function_locked";
  const label = "Score aggregate is server-only";
  if (grantees === null) {
    return {
      id,
      label,
      severity: "recommended",
      status: "unknown",
      detail: "Could not read function grants.",
    };
  }
  const leaked = grantees.filter((role) => role === "anon" || role === "authenticated");
  if (leaked.length > 0) {
    return {
      id,
      label,
      severity: "required",
      status: "fail",
      detail: `${leaked.join(" and ")} can execute the SECURITY DEFINER score aggregate directly. Revoke it: revoke all on function public.concert_battle_gift_totals(uuid) from ${leaked.join(", ")};`,
    };
  }
  return { id, label, severity: "recommended", status: "pass", detail: "" };
}

function giftSendIndexCheck(exists: boolean | null): ConcertCheck {
  const id: ConcertCheckId = "gift_send_index";
  const label = "gift_sends_space_target_idx";
  if (exists === null) {
    return { id, label, severity: "recommended", status: "unknown", detail: "Could not read pg_indexes." };
  }
  if (!exists) {
    return {
      id,
      label,
      severity: "recommended",
      status: "fail",
      detail:
        "The score aggregate will still be correct but scans gift_sends unindexed, which gets slow as gift volume grows. Apply migration 066.",
    };
  }
  return { id, label, severity: "recommended", status: "pass", detail: "" };
}

/** Human-readable report. Kept pure so the test can assert on the text. */
export function formatConcertReadinessReport(result: {
  checks: readonly ConcertCheck[];
  ready: boolean;
}): string {
  const symbol: Record<ConcertCheckStatus, string> = { pass: "ok  ", fail: "FAIL", unknown: "????" };
  const lines = result.checks.map((check) => {
    const scope = check.severity === "required" ? "required" : "advisory";
    const head = `  ${symbol[check.status]}  ${check.label} (${scope})`;
    return check.detail ? `${head}\n        ${check.detail}` : head;
  });
  const verdict = result.ready
    ? "Concert is configured: a live battle can connect and score."
    : "Concert is NOT ready — the required items above must be resolved first.";
  return `${lines.join("\n")}\n\n${verdict}`;
}
