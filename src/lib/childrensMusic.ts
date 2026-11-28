// Children's music on the catalog (Karl, 28 Nov 2026).
//
// "Children's" is a genre, not a release type: an artist tags a track or album
// with it in Studio, and the Music catalog lists it under its own Children's
// pill. Like Shows, children's releases are kept out of All Releases / Albums /
// Singles so kids' songs never sit in the same grid as adult music, and an
// explicit release never appears under Children's even if it is tagged that way.

export const CHILDRENS_GENRE = "Children's";

// Spellings an uploader or an older row might use for the same thing.
const CHILDRENS_KEYS = new Set([
  "children's",
  "childrens",
  "children",
  "children’s", // curly apostrophe
  "kids",
  "kid's",
  "kids music",
  "kids' music",
]);

export function isChildrensGenre(genre: string | null | undefined): boolean {
  if (!genre) return false;
  return CHILDRENS_KEYS.has(genre.trim().toLowerCase());
}

/** True when a catalog item belongs under the Children's pill. */
export function isChildrensItem(item: {
  genre: string | null;
  explicit?: boolean;
  isShow?: boolean;
}): boolean {
  return !item.isShow && item.explicit !== true && isChildrensGenre(item.genre);
}
