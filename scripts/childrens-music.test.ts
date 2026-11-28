import assert from "node:assert/strict";
import { isChildrensGenre, isChildrensItem, CHILDRENS_GENRE } from "../src/lib/childrensMusic";

// Uploader label and common spellings all count.
for (const g of [CHILDRENS_GENRE, "childrens", "Children", "Kids", " kids ", "Children’s"]) {
  assert.equal(isChildrensGenre(g), true, `expected children's: ${g}`);
}
for (const g of ["R&B", "Gospel", "Other", "", null, undefined, "Kidz Bop Remix"]) {
  assert.equal(isChildrensGenre(g as string | null | undefined), false, `not children's: ${g}`);
}
// Explicit releases and shows never land under Children's.
assert.equal(isChildrensItem({ genre: "Children's" }), true);
assert.equal(isChildrensItem({ genre: "Children's", explicit: true }), false);
assert.equal(isChildrensItem({ genre: "Children's", isShow: true }), false);
assert.equal(isChildrensItem({ genre: "R&B" }), false);
console.log("childrens-music: all assertions passed");
