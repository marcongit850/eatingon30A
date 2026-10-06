/**
 * Listing overlay for both guides. The CSV build stays the baseline.
 * Rows here are the admin's creates, edits, drafts, and deletions.
 * Photo bytes live in the PHOTOS R2 bucket. The table only stores the id.
 */

import {
  MAX_PHOTO_BYTES,
  SITES,
  isSlug,
  listingSlug,
  sniffImage,
  validateListing,
  validatePhotos,
} from "../listing-model.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function siteFrom(value) {
  const site = String(value || "");
  return SITES.has(site) ? site : "";
}

function parsePayload(value) {
  try {
    const data = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

export function rowsFrom(result) {
  return (result && result.results ? result.results : []).map((row) => {
    const payload = parsePayload(row.payload);
    if (!payload) return null;
    return {
      slug: row.slug,
      status: row.status === "draft" ? "draft" : "live",
      deleted: Number(row.deleted) === 1,
      payload,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by || "",
    };
  }).filter(Boolean);
}

async function photoIds(db, site, slug) {
  const result = await db.prepare(
    "SELECT id FROM listing_photos WHERE site = ? AND slug = ?",
  ).bind(site, slug).all();
  return new Set((result.results || []).map((row) => row.id));
}

async function writeListing(db, site, slug, status, payload, email) {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO listings (site, slug, status, deleted, payload, updated_at, updated_by)
     VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(site, slug) DO UPDATE SET
       status = excluded.status,
       deleted = 0,
       payload = excluded.payload,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).bind(site, slug, status, JSON.stringify(payload), now, email || "").run();
  return { slug, status, deleted: false, payload, updatedAt: now };
}

function keepLogo(value) {
  const text = String(value || "");
  if (text.startsWith("/images/") && !text.includes("..")) return text;
  if (/^https:\/\/[^\s]+$/.test(text) && text.length <= 300) return text;
  return "";
}

function storedPayload(value, logo) {
  const payload = { ...value };
  if (logo) payload.logo = logo;
  return payload;
}

async function takenSlugs(db, site) {
  const result = await db.prepare("SELECT slug FROM listings WHERE site = ?").bind(site).all();
  return new Set((result.results || []).map((row) => row.slug));
}

export async function listCatalog(db, site) {
  if (!siteFrom(site)) return json({ ok: false, error: "That guide is not valid." }, 400);
  const result = await db.prepare(
    "SELECT slug, status, deleted, payload, updated_at, updated_by FROM listings WHERE site = ?",
  ).bind(site).all();
  return json({ ok: true, site, listings: rowsFrom(result) });
}

export async function createListing(db, body, email) {
  const site = siteFrom(body && body.site);
  if (!site) return json({ ok: false, error: "That guide is not valid." }, 400);
  const parsed = validateListing(body || {}, { allowedPhotoIds: new Set() });
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const requested = body && body.slug ? String(body.slug) : "";
  const used = await takenSlugs(db, site);
  for (const slug of body && Array.isArray(body.usedSlugs) ? body.usedSlugs : []) {
    if (isSlug(slug)) used.add(slug);
  }
  let slug = requested;
  if (slug) {
    if (!isSlug(slug) || used.has(slug)) return json({ ok: false, error: "That address is already in use." }, 409);
  } else {
    slug = listingSlug(parsed.value.name, parsed.value.area, used);
  }
  const saved = await writeListing(db, site, slug, parsed.status, storedPayload(parsed.value, ""), email);
  return json({ ok: true, listing: { site, ...saved } });
}

export async function updateListing(db, env, slug, body, email) {
  const site = siteFrom(body && body.site);
  if (!site || !isSlug(slug)) return json({ ok: false, error: "That listing could not be saved." }, 400);
  const allowed = await photoIds(db, site, slug);
  const parsed = validateListing(body || {}, { allowedPhotoIds: allowed });
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const current = await db.prepare(
    "SELECT payload FROM listings WHERE site = ? AND slug = ?",
  ).bind(site, slug).first();
  const previous = current ? parsePayload(current.payload) : null;
  const logo = keepLogo(body && body.logo) || keepLogo(previous && previous.logo);
  const photos = await dropRemovedPhotos(db, env && env.PHOTOS, site, slug, parsed.value.photos, allowed);
  const saved = await writeListing(db, site, slug, parsed.status, storedPayload({ ...parsed.value, photos }, logo), email);
  return json({ ok: true, listing: { site, ...saved } });
}

async function dropRemovedPhotos(db, bucket, site, slug, photos, allowed) {
  const keep = new Set(photos.filter((photo) => photo.id).map((photo) => photo.id));
  for (const id of allowed) {
    if (keep.has(id)) continue;
    await db.prepare("DELETE FROM listing_photos WHERE id = ? AND site = ? AND slug = ?").bind(id, site, slug).run();
    if (bucket) await bucket.delete(photoKey(id));
  }
  return photos;
}

function photoKey(id) {
  return `photos/${id}`;
}

function photosReady(env) {
  return env && env.PHOTOS && typeof env.PHOTOS.put === "function";
}

export async function deleteListing(db, env, site, slug, email) {
  if (!siteFrom(site) || !isSlug(slug)) return json({ ok: false, error: "That listing could not be deleted." }, 400);
  const now = Date.now();
  const existing = await db.prepare(
    "SELECT payload, status FROM listings WHERE site = ? AND slug = ?",
  ).bind(site, slug).first();
  const payload = existing ? (parsePayload(existing.payload) || {}) : {};
  payload.photos = (payload.photos || []).filter((photo) => !photo.id);
  if (existing) {
    await db.prepare(
      "UPDATE listings SET deleted = 1, payload = ?, updated_at = ?, updated_by = ? WHERE site = ? AND slug = ?",
    ).bind(JSON.stringify(payload), now, email || "", site, slug).run();
  } else {
    await db.prepare(
      "INSERT INTO listings (site, slug, status, deleted, payload, updated_at, updated_by) VALUES (?, ?, 'draft', 1, ?, ?, ?)",
    ).bind(site, slug, JSON.stringify(payload), now, email || "").run();
  }
  const ids = await photoIds(db, site, slug);
  for (const id of ids) {
    await db.prepare("DELETE FROM listing_photos WHERE id = ?").bind(id).run();
    if (photosReady(env)) await env.PHOTOS.delete(photoKey(id));
  }
  return json({ ok: true });
}

export async function addPhoto(db, env, site, slug, bytes) {
  if (!siteFrom(site) || !isSlug(slug)) return json({ ok: false, error: "That photo could not be saved." }, 400);
  if (!photosReady(env)) return json({ ok: false, error: "Photo storage is not set up yet." }, 503);
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > MAX_PHOTO_BYTES) {
    return json({ ok: false, error: "That file is too large. Keep each image under 5 MB." }, 400);
  }
  const contentType = sniffImage(bytes);
  if (!contentType) return json({ ok: false, error: "Use a JPEG, PNG, or WebP image." }, 400);
  const row = await db.prepare(
    "SELECT payload, status FROM listings WHERE site = ? AND slug = ? AND deleted = 0",
  ).bind(site, slug).first();
  if (!row) return json({ ok: false, error: "Save the listing before adding photos." }, 400);
  const payload = parsePayload(row.payload) || {};
  const photos = Array.isArray(payload.photos) ? payload.photos : [];
  if (photos.length >= 24) return json({ ok: false, error: "Keep it to 24 photos." }, 400);
  const id = crypto.randomUUID();
  await env.PHOTOS.put(photoKey(id), bytes, { httpMetadata: { contentType } });
  const now = Date.now();
  await db.prepare(
    "INSERT INTO listing_photos (id, site, slug, content_type, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, site, slug, contentType, now).run();
  const photo = { id, src: `/media/photos/${id}` };
  payload.photos = [...photos, photo];
  await db.prepare(
    "UPDATE listings SET payload = ?, updated_at = ? WHERE site = ? AND slug = ?",
  ).bind(JSON.stringify(payload), now, site, slug).run();
  return json({ ok: true, photo, photos: payload.photos });
}

export async function removePhoto(db, env, site, slug, id) {
  if (!siteFrom(site) || !isSlug(slug) || !/^[a-f0-9-]{36}$/.test(id)) {
    return json({ ok: false, error: "That photo could not be deleted." }, 400);
  }
  const row = await db.prepare(
    "SELECT payload FROM listings WHERE site = ? AND slug = ? AND deleted = 0",
  ).bind(site, slug).first();
  if (!row) return json({ ok: false, error: "That photo could not be deleted." }, 404);
  const payload = parsePayload(row.payload) || {};
  payload.photos = (payload.photos || []).filter((photo) => photo.id !== id && photo.src !== `/media/photos/${id}`);
  await db.prepare("DELETE FROM listing_photos WHERE id = ? AND site = ? AND slug = ?").bind(id, site, slug).run();
  if (photosReady(env)) await env.PHOTOS.delete(photoKey(id));
  await db.prepare(
    "UPDATE listings SET payload = ?, updated_at = ? WHERE site = ? AND slug = ?",
  ).bind(JSON.stringify(payload), Date.now(), site, slug).run();
  return json({ ok: true, photos: payload.photos });
}

export async function orderPhotos(db, env, site, slug, photos) {
  if (!siteFrom(site) || !isSlug(slug)) return json({ ok: false, error: "Those photos could not be reordered." }, 400);
  const allowed = await photoIds(db, site, slug);
  const parsed = validatePhotos(photos, allowed);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const row = await db.prepare(
    "SELECT payload FROM listings WHERE site = ? AND slug = ? AND deleted = 0",
  ).bind(site, slug).first();
  if (!row) return json({ ok: false, error: "Save the listing before reordering photos." }, 400);
  const payload = parsePayload(row.payload) || {};
  payload.photos = await dropRemovedPhotos(db, env && env.PHOTOS, site, slug, parsed.value, allowed);
  await db.prepare(
    "UPDATE listings SET payload = ?, updated_at = ? WHERE site = ? AND slug = ?",
  ).bind(JSON.stringify(payload), Date.now(), site, slug).run();
  return json({ ok: true, photos: payload.photos });
}

export async function readPhoto(env, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return json({ ok: false, error: "Not found." }, 404);
  const row = await env.DB.prepare(
    "SELECT content_type FROM listing_photos WHERE id = ?",
  ).bind(id).first();
  if (!row || !photosReady(env)) return json({ ok: false, error: "Not found." }, 404);
  const object = await env.PHOTOS.get(photoKey(id));
  if (!object) return json({ ok: false, error: "Not found." }, 404);
  const bytes = await object.arrayBuffer();
  return new Response(bytes, {
    headers: {
      "content-type": row.content_type || "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleAdminApi(request, env, user) {
  const url = new URL(request.url);
  const site = siteFrom(url.searchParams.get("site"));
  const email = user && user.email;
  if (request.method === "GET" && url.pathname === "/v1/admin/listings") {
    return listCatalog(env.DB, site || request.headers.get("x-account-site"));
  }
  if (request.method === "POST" && url.pathname === "/v1/admin/listings") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Send the listing as JSON." }, 400);
    }
    return createListing(env.DB, body, email);
  }
  const photo = url.pathname.match(/^\/v1\/admin\/listings\/([a-z0-9-]+)\/photos\/([a-f0-9-]+)$/);
  if (photo && request.method === "DELETE") {
    return removePhoto(env.DB, env, site || request.headers.get("x-account-site"), photo[1], photo[2]);
  }
  const photos = url.pathname.match(/^\/v1\/admin\/listings\/([a-z0-9-]+)\/photos$/);
  if (photos && request.method === "POST") {
    const bytes = new Uint8Array(await request.arrayBuffer());
    return addPhoto(env.DB, env, site || request.headers.get("x-account-site"), photos[1], bytes);
  }
  if (photos && request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Send the photos as JSON." }, 400);
    }
    return orderPhotos(env.DB, env, site || (body && body.site) || request.headers.get("x-account-site"), photos[1], body && body.photos);
  }
  const one = url.pathname.match(/^\/v1\/admin\/listings\/([a-z0-9-]+)$/);
  if (one && request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Send the listing as JSON." }, 400);
    }
    return updateListing(env.DB, env, one[1], body, email);
  }
  if (one && request.method === "DELETE") {
    return deleteListing(env.DB, env, site || request.headers.get("x-account-site"), one[1], email);
  }
  return json({ ok: false, error: "Not found." }, 404);
}
