/**
 * 2×2 photo window on a restaurant profile.
 * Each step moves one photo so every frame can sit in the grid.
 * The ends stop; they do not wrap.
 */

export const GALLERY_WINDOW = 4;

export function clampGalleryIndex(index, total, windowSize = GALLERY_WINDOW) {
  const count = Math.max(0, Number(total) || 0);
  const size = Math.max(1, Number(windowSize) || GALLERY_WINDOW);
  const max = Math.max(0, count - size);
  const start = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.max(0, Math.min(max, start));
}

export function galleryEnd(index, total, windowSize = GALLERY_WINDOW) {
  const count = Math.max(0, Number(total) || 0);
  if (!count) return 0;
  const start = clampGalleryIndex(index, count, windowSize);
  return Math.min(start + windowSize, count);
}

export function galleryLabel(index, total, windowSize = GALLERY_WINDOW) {
  const count = Math.max(0, Number(total) || 0);
  const end = galleryEnd(index, count, windowSize);
  const noun = count === 1 ? "photo" : "photos";
  return `${end} of ${count} ${noun}`;
}

export function tileInGalleryWindow(tileIndex, index, total, windowSize = GALLERY_WINDOW) {
  const start = clampGalleryIndex(index, total, windowSize);
  return tileIndex >= start && tileIndex < start + windowSize;
}

function renderGallery(root, tiles, index) {
  const total = tiles.length;
  tiles.forEach((tile, tileIndex) => {
    tile.hidden = !tileInGalleryWindow(tileIndex, index, total);
  });
  const count = root.querySelector(".profile-gallery-count");
  const label = galleryLabel(index, total);
  if (count && count.textContent !== label) count.textContent = label;
  const prev = root.querySelector(".profile-gallery-prev");
  const next = root.querySelector(".profile-gallery-next");
  if (prev) prev.disabled = index === 0;
  if (next) next.disabled = index >= clampGalleryIndex(Number.POSITIVE_INFINITY, total);
}

function bootGallery(root) {
  const tiles = [...root.querySelectorAll(".profile-gallery-tile")];
  const total = tiles.length;
  if (total <= GALLERY_WINDOW) return;
  let index = 0;
  const prev = root.querySelector(".profile-gallery-prev");
  const next = root.querySelector(".profile-gallery-next");

  const step = (delta) => {
    const nextIndex = clampGalleryIndex(index + delta, total);
    if (nextIndex === index) return;
    const active = document.activeElement;
    index = nextIndex;
    renderGallery(root, tiles, index);
    if (active === prev && prev && prev.disabled && next) next.focus();
    else if (active === next && next && next.disabled && prev) prev.focus();
  };

  renderGallery(root, tiles, index);

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("[data-gallery-step]");
    if (!button || !root.contains(button) || button.disabled) return;
    step(Number(button.getAttribute("data-gallery-step")));
  });

  root.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".profile-gallery-arrow")) return;
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  });
}

function boot() {
  document.querySelectorAll(".profile-gallery").forEach((root) => bootGallery(root));
}

if (typeof document !== "undefined") boot();
