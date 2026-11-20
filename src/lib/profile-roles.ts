// Single source of truth for profiles.role values, safe to import from both
// client and server code. Must match the live `profiles_role_check` constraint
// (migration 069 added 'snappd'). "user" is NOT a valid role.
export const PROFILE_ROLES = ["free", "superfan", "artist", "snappd", "admin"] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

export function isProfileRole(value: unknown): value is ProfileRole {
  return typeof value === "string" && (PROFILE_ROLES as readonly string[]).includes(value);
}
