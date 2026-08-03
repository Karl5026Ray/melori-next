import { slugify } from "@/lib/slug";

export const FOLDER_QUERY_PARAM = "folder";

/**
 * Stable, shareable identifier for every folder/category tile in a gallery.
 *
 * We prefer the slugified folder name so shared links read like
 * `/gallery/spring-shoot?folder=behind-the-scenes`, and fall back to the raw
 * folder id when the name slugifies to nothing (e.g. emoji-only) or when two
 * folders would otherwise claim the same slug.
 *
 * Returns a map of group key -> share key. Callers resolve an incoming
 * `?folder=` value against both the share key and the group key so links minted
 * before a folder was renamed still resolve by id.
 */
export function folderShareKeys(
  groups: { key: string; name: string }[],
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const slug = slugify(group.name);
    if (slug) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const group of groups) {
    const slug = slugify(group.name);
    result.set(group.key, slug && counts.get(slug) === 1 ? slug : group.key);
  }
  return result;
}
