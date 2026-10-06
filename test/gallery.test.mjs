import assert from "node:assert/strict";
import test from "node:test";
import { clampGalleryIndex, galleryEnd, galleryLabel, tileInGalleryWindow } from "../gallery.js";

test("the counter names the last photo in the window", () => {
  assert.equal(galleryLabel(0, 9), "4 of 9 photos");
  assert.equal(galleryLabel(1, 9), "5 of 9 photos");
  assert.equal(galleryLabel(5, 9), "9 of 9 photos");
  assert.equal(galleryLabel(0, 6), "4 of 6 photos");
  assert.equal(galleryLabel(2, 6), "6 of 6 photos");
  assert.equal(galleryLabel(0, 4), "4 of 4 photos");
  assert.equal(galleryLabel(0, 3), "3 of 3 photos");
  assert.equal(galleryLabel(0, 1), "1 of 1 photo");
});

test("paging stops at the ends", () => {
  assert.equal(clampGalleryIndex(-4, 6), 0);
  assert.equal(clampGalleryIndex(0, 6), 0);
  assert.equal(clampGalleryIndex(2, 6), 2);
  assert.equal(clampGalleryIndex(8, 6), 2);
  assert.equal(galleryEnd(8, 6), 6);
  assert.equal(clampGalleryIndex(1, 3), 0);
});

test("a step of one lets every photo enter the window", () => {
  for (const total of [1, 2, 3, 4, 5, 6, 7, 9]) {
    const max = clampGalleryIndex(total, total);
    for (let photo = 0; photo < total; photo++) {
      const seen = [];
      for (let start = 0; start <= max; start++) {
        if (tileInGalleryWindow(photo, start, total)) seen.push(start);
      }
      assert.ok(seen.length > 0, `photo ${photo + 1} of ${total} never appears`);
    }
    for (let start = 0; start <= max; start++) {
      const visible = [];
      for (let photo = 0; photo < total; photo++) {
        if (tileInGalleryWindow(photo, start, total)) visible.push(photo);
      }
      assert.equal(visible.length, Math.min(4, total));
      assert.equal(galleryEnd(start, total), visible[visible.length - 1] + 1);
    }
  }
});
