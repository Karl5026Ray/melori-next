import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve a folder path (array of folder names, ordered root-first) inside a
 * gallery into a folder UUID. Walks the existing tree and creates any missing
 * levels as it goes. Returns the leaf folder's id, or null if the path is
 * empty (meaning "top-level, no folder").
 *
 * Path sanitization: names are trimmed and empty segments are dropped.
 * Length cap: individual names >120 chars are truncated; paths >20 levels
 * deep are rejected. These limits exist to prevent an accidentally huge
 * folder tree from bloating the DB during a mis-configured upload.
 *
 * Uniqueness relies on the composite index
 *   (gallery_id, coalesce(parent_folder_id, sentinel), name)
 * added in migration 039. If two concurrent uploaders try to create the
 * same leaf, one insert will fail with 23505 and this helper retries the
 * select. That's why the "create" step catches the conflict and re-reads.
 */
export async function resolveFolderPath(
  supabase: SupabaseClient,
  galleryId: string,
  path: string[],
): Promise<string | null> {
  const cleaned = (path ?? [])
    .map((p) => String(p ?? "").trim().slice(0, 120))
    .filter((p) => p.length > 0);

  if (cleaned.length === 0) return null;
  if (cleaned.length > 20) {
    throw new Error(`Folder nesting too deep (max 20, got ${cleaned.length})`);
  }

  let parentId: string | null = null;
  for (const name of cleaned) {
    parentId = await ensureFolder(supabase, galleryId, parentId, name);
  }
  return parentId;
}

async function ensureFolder(
  supabase: SupabaseClient,
  galleryId: string,
  parentId: string | null,
  name: string,
): Promise<string> {
  // Look for an existing sibling with this name first.
  const existing = await findChildByName(supabase, galleryId, parentId, name);
  if (existing) return existing;

  // Not there — insert. Race-safe: if a sibling gets created between the
  // SELECT and the INSERT, the unique index will 23505 and we re-read.
  const { data, error } = await supabase
    .from("photo_gallery_folders")
    .insert({
      gallery_id: galleryId,
      parent_folder_id: parentId,
      name,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation — someone else won the race, re-select.
    if (error.code === "23505") {
      const raced = await findChildByName(supabase, galleryId, parentId, name);
      if (raced) return raced;
    }
    throw new Error(
      `Could not create folder '${name}' under ${parentId ?? "(root)"}: ${error.message}`,
    );
  }

  if (!data?.id) {
    throw new Error(`Folder insert returned no id for '${name}'`);
  }
  return data.id as string;
}

async function findChildByName(
  supabase: SupabaseClient,
  galleryId: string,
  parentId: string | null,
  name: string,
): Promise<string | null> {
  const query = supabase
    .from("photo_gallery_folders")
    .select("id")
    .eq("gallery_id", galleryId)
    .eq("name", name)
    .limit(1);

  // Supabase treats .is(col, null) and .eq(col, uuid) differently, and the
  // NULL case needs .is() — otherwise the row is never matched.
  const scoped = parentId
    ? query.eq("parent_folder_id", parentId)
    : query.is("parent_folder_id", null);

  const { data, error } = await scoped;
  if (error) {
    throw new Error(`Folder lookup failed for '${name}': ${error.message}`);
  }
  return data?.[0]?.id ?? null;
}

/**
 * Type describing a folder row as returned by the public viewer / studio.
 */
export interface FolderRow {
  id: string;
  name: string;
  parent_folder_id: string | null;
  order_index: number;
}

/**
 * Build a nested tree from a flat list of folders. Roots are folders with
 * parent_folder_id === null. Children are ordered by order_index then name.
 * Any folder whose parent is missing is treated as a root (defensive).
 */
export interface FolderTreeNode extends FolderRow {
  children: FolderTreeNode[];
}

export function buildFolderTree(rows: FolderRow[]): FolderTreeNode[] {
  const byId = new Map<string, FolderTreeNode>();
  for (const r of rows) {
    byId.set(r.id, { ...r, children: [] });
  }
  const roots: FolderTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_folder_id && byId.has(node.parent_folder_id)) {
      byId.get(node.parent_folder_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (nodes: FolderTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.order_index !== b.order_index) return a.order_index - b.order_index;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}
