/**
 * Merge the built catalog with admin rows from the accounts Worker.
 * A missing row means the built listing is live. Draft and deleted rows
 * stay out of the public guide. Created rows exist only in the overlay.
 */

import { publicRecord, slugify } from "./listing-model.js";

function photosOf(value) {
  const list = Array.isArray(value) ? value : [];
  const photos = [];
  for (const item of list) {
    if (typeof item === "string" && item.startsWith("/")) photos.push({ id: null, src: item });
    else if (item && typeof item.src === "string" && item.src.startsWith("/")) {
      photos.push({ id: item.id || null, src: item.src });
    }
  }
  return photos;
}

export function presentListing(raw) {
  const area = raw.area || "";
  return {
    ...raw,
    area,
    areaSlug: slugify(area),
    subarea: raw.subarea || "",
    label: raw.label || "",
    address: raw.address || "",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    phone: raw.phone || "",
    website: raw.website || "",
    facebook: raw.facebook || "",
    instagram: raw.instagram || "",
    price: raw.price || "",
    notes: raw.notes || "",
    hours: raw.hours || "",
    cuisines: raw.cuisines || [],
    meals: raw.meals || [],
    foods: raw.foods || [],
    vibes: raw.vibes || [],
    category: raw.category || "",
    outdoor: Boolean(raw.outdoor),
    kids: Boolean(raw.kids),
    music: Boolean(raw.music),
    reservations: Boolean(raw.reservations),
    groups: Boolean(raw.groups),
    happyFood: Boolean(raw.happyFood),
    happyDrinks: Boolean(raw.happyDrinks),
    laurensFavorite: Boolean(raw.laurensFavorite),
    photos: photosOf(raw.photos),
    logo: raw.logo || "",
    search: raw.search || "",
    status: raw.status === "draft" ? "draft" : "live",
    deleted: Boolean(raw.deleted),
    source: raw.source || "baseline",
  };
}

export function mergeCatalog(baseline, rows) {
  const map = new Map();
  for (const item of baseline || []) {
    map.set(item.slug, presentListing({ ...item, status: "live", deleted: false, source: "baseline" }));
  }
  for (const row of rows || []) {
    const previous = map.get(row.slug);
    const payload = row.payload || {};
    map.set(row.slug, presentListing({
      ...(previous || {}),
      ...payload,
      logo: payload.logo || (previous && previous.logo) || "",
      slug: row.slug,
      status: row.status === "draft" ? "draft" : "live",
      deleted: Boolean(row.deleted),
      source: previous ? "override" : "created",
      updatedAt: row.updatedAt || null,
    }));
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function isPublicListing(listing) {
  return Boolean(listing) && !listing.deleted && listing.status === "live";
}

export function liveListings(merged) {
  return merged.filter(isPublicListing);
}

export function publicRecords(merged) {
  return liveListings(merged).map(publicRecord);
}

export function bySlug(merged) {
  return new Map(merged.map((listing) => [listing.slug, listing]));
}
