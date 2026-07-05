// Small shared validators for API route input. Everything here is defensive:
// the routes still do their own domain checks, these just reject obvious
// garbage before we hand it to Postgres and either explode with an opaque
// error or silently store nonsense.

// RFC 4122 UUID (any version). We use this to guard columns that reference
// auth.users.id / profiles.id \u2014 the client-supplied string must at least look
// like a UUID before we run cross-table lookups against it. Without this the
// DB just returns \"no rows\" for garbage input, which is fine for security but
// noisy in logs and wasteful in DB round-trips.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// Trim + normalise, returning null when the input isn't a usable string. Used
// widely for optional text fields where "" and "   " should behave the same
// as \"missing\".
export function trimOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// Bounded trimmed string \u2014 returns { ok: true, value } or { ok: false, error }.
// Callers use this for user-visible text fields so oversized pastes get a
// clear 400 instead of silently truncating (which can look like data loss).
export function boundedString(
  v: unknown,
  opts: { field: string; min?: number; max: number; required?: boolean },
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v == null || v === "") {
    if (opts.required) {
      return { ok: false, error: `${opts.field} is required` };
    }
    return { ok: true, value: null };
  }
  if (typeof v !== "string") {
    return { ok: false, error: `${opts.field} must be a string` };
  }
  const trimmed = v.trim();
  const min = opts.min ?? 1;
  if (trimmed.length < min) {
    if (opts.required) {
      return { ok: false, error: `${opts.field} is required` };
    }
    return { ok: true, value: null };
  }
  if (trimmed.length > opts.max) {
    return { ok: false, error: `${opts.field} too long (max ${opts.max})` };
  }
  return { ok: true, value: trimmed };
}
