// Pure helpers for the owner's profile gallery editor
// (src/components/social/ProfileGalleryEditor.tsx). Kept free of React and
// Tailwind so they can be unit-tested (scripts/profile-gallery-order.test.ts).

export const GALLERY_MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB
export const GALLERY_MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60MB

/** Return a copy of `list` with the item at `from` moved to index `to`.
 *  Out-of-range or no-op moves return the list unchanged (same reference). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list as T[];
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Id order to send to the reorder PATCH after `newId` replaces `oldId`:
 *  the new item takes the old item's position, and the old item goes to the
 *  end (it is about to be deleted; if that delete fails it stays, last).
 *  `ids` is the current order and may or may not already contain `newId`. */
export function replaceOrder(
  ids: readonly string[],
  oldId: string,
  newId: string,
): string[] {
  const without = ids.filter((id) => id !== newId);
  const at = without.indexOf(oldId);
  if (at === -1) return [...without, newId];
  const next = [...without];
  next[at] = newId;
  next.push(oldId);
  return next;
}

export type UploadCandidate = { name: string; type: string; size: number };
export type SkipReason = "type" | "too_big" | "over_limit";

/** Which files of a multi-select can be uploaded. Files are kept in the order
 *  picked; anything of the wrong type or too big is skipped first, then the
 *  rest are accepted until `remaining` slots are used. */
export function planUploads<F extends UploadCandidate>(
  files: readonly F[],
  remaining: number,
): { accepted: F[]; skipped: { file: F; reason: SkipReason }[] } {
  const accepted: F[] = [];
  const skipped: { file: F; reason: SkipReason }[] = [];
  let left = Math.max(0, remaining);
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      skipped.push({ file, reason: "type" });
    } else if (
      (isImage && file.size > GALLERY_MAX_IMAGE_BYTES) ||
      (isVideo && file.size > GALLERY_MAX_VIDEO_BYTES)
    ) {
      skipped.push({ file, reason: "too_big" });
    } else if (left <= 0) {
      skipped.push({ file, reason: "over_limit" });
    } else {
      accepted.push(file);
      left -= 1;
    }
  }
  return { accepted, skipped };
}

export function skipMessage(reason: SkipReason, max: number): string {
  switch (reason) {
    case "type":
      return "not a photo or video";
    case "too_big":
      return "too big (photos up to 12MB, videos up to 60MB)";
    case "over_limit":
      return `over the ${max}-item limit`;
  }
}
