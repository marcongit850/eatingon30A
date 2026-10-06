/**
 * Admin API for one guide. The browser talks only to this origin.
 * Listing rows and photo bytes are stored by the shared accounts Worker.
 * Keep this file easy to copy into eatingindestin: it reads ACCOUNT_SITE
 * and does not hard-code 30A paths except the built catalog, which is empty
 * for a guide that has not generated data/catalog.json.
 */

import listingOptions from "./data/listing-form.json" with { type: "json" };
import { liveListings } from "./catalog.js";
import { baselineFor, invalidateCatalog, loadOverrides, mergedCatalog } from "./catalog-store.js";
import { isSlug, sniffImage, MAX_PHOTO_BYTES } from "./listing-model.js";
import { accountsFetch, accountsJson, readCookie, siteId } from "./shared-accounts.js";

const SITES = [
  { id: "30a", label: "Eating on 30A" },
  { id: "destin", label: "Eating in Destin" },
];

function json(body, status = 200, headers) {
  const out = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (headers) headers.forEach((value, key) => out.append(key, value));
  return new Response(JSON.stringify(body), { status, headers: out });
}

function guideSite(value, env) {
  const site = String(value || siteId(env) || "");
  return site === "30a" || site === "destin" ? site : "";
}

async function requireAdmin(request, env) {
  const result = await accountsJson(await accountsFetch(env, "/v1/me", { session: readCookie(request) }));
  const user = result.body && result.body.user;
  if (!user) return json({ ok: false, error: "Sign in to edit listings." }, 401);
  if (!user.isAdmin) return json({ ok: false, error: "This account cannot edit listings." }, 403);
  return null;
}

function choices(baseline, key, fallback) {
  const found = [];
  const seen = new Set();
  for (const value of fallback || []) {
    if (!seen.has(value)) {
      seen.add(value);
      found.push(value);
    }
  }
  for (const listing of baseline) {
    const values = Array.isArray(listing[key]) ? listing[key] : [];
    for (const value of values) {
      if (value && !seen.has(value)) {
        seen.add(value);
        found.push(value);
      }
    }
  }
  return found;
}

function areasFor(site) {
  if (site !== "30a") return [];
  const names = new Set(listingOptions.areas || []);
  for (const listing of baselineFor("30a")) {
    if (listing.area) names.add(listing.area);
  }
  return [...names];
}

function summary(listing) {
  return {
    slug: listing.slug,
    name: listing.name,
    area: listing.area,
    areaSlug: listing.areaSlug,
    status: listing.status,
    photoCount: (listing.photos || []).length,
    updatedAt: listing.updatedAt || null,
    source: listing.source,
  };
}

function editorListing(listing, site) {
  return {
    site,
    slug: listing.slug,
    status: listing.deleted ? "draft" : listing.status,
    name: listing.name,
    area: listing.area,
    subarea: listing.subarea,
    label: listing.label,
    address: listing.address,
    lat: listing.lat,
    lng: listing.lng,
    phone: listing.phone,
    website: listing.website,
    facebook: listing.facebook,
    instagram: listing.instagram,
    price: listing.price,
    notes: listing.notes,
    hours: listing.hours,
    cuisines: listing.cuisines,
    meals: listing.meals,
    foods: listing.foods,
    vibes: listing.vibes,
    category: listing.category,
    outdoor: listing.outdoor,
    kids: listing.kids,
    music: listing.music,
    reservations: listing.reservations,
    groups: listing.groups,
    happyFood: listing.happyFood,
    happyDrinks: listing.happyDrinks,
    laurensFavorite: listing.laurensFavorite,
    photos: listing.photos,
    logo: listing.logo || "",
  };
}

async function visibleMerged(env, site) {
  const merged = await mergedCatalog(env, site, { fresh: true });
  return merged.filter((listing) => !listing.deleted);
}

async function callAccounts(env, request, path, options) {
  const result = await accountsJson(await accountsFetch(env, path, {
    ...options,
    session: readCookie(request),
  }));
  return result;
}

async function ensureRow(env, request, site, slug, status) {
  const rows = await loadOverrides(env, site, { fresh: true });
  if (rows.some((row) => row.slug === slug && !row.deleted)) return true;
  const baseline = baselineFor(site).find((item) => item.slug === slug);
  if (!baseline) return false;
  const saved = await callAccounts(env, request, `/v1/admin/listings/${slug}`, {
    method: "PUT",
    body: { ...baseline, site, status: status || "live", logo: baseline.logo || "" },
  });
  invalidateCatalog(site);
  return saved.status < 400 && saved.body && saved.body.ok;
}

export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith("/media/photos/")) return servePhoto(request, env);
  if (path !== "/api/admin" && !path.startsWith("/api/admin/")) return null;
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  if (path === "/api/admin/options" && request.method === "GET") {
    const baseline = baselineFor("30a");
    return json({
      ok: true,
      sites: SITES.map((site) => ({ ...site, areas: areasFor(site.id) })),
      cuisines: choices(baseline, "cuisines", listingOptions.cuisines),
      foods: choices(baseline, "foods", listingOptions.foods),
      meals: choices(baseline, "meals", listingOptions.meals),
      prices: listingOptions.prices || ["$", "$$", "$$$", "$$$$"],
    });
  }

  if (path === "/api/admin/listings" && request.method === "GET") {
    const site = guideSite(url.searchParams.get("site"), env);
    if (!site) return json({ ok: false, error: "That guide is not valid." }, 400);
    const merged = await visibleMerged(env, site);
    return json({ ok: true, site, listings: merged.map(summary) });
  }

  if (path === "/api/admin/listings" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Send the listing as JSON." }, 400);
    }
    const site = guideSite(body.site, env);
    if (!site) return json({ ok: false, error: "That guide is not valid." }, 400);
    const merged = await mergedCatalog(env, site, { fresh: true });
    const result = await callAccounts(env, request, "/v1/admin/listings", {
      method: "POST",
      body: { ...body, site, usedSlugs: merged.map((listing) => listing.slug) },
    });
    if (result.status < 400) invalidateCatalog(site);
    return json(result.body, result.status);
  }

  const photo = path.match(/^\/api\/admin\/listings\/([a-z0-9-]+)\/photos\/([a-f0-9-]+)$/);
  if (photo && request.method === "DELETE") {
    const site = guideSite(url.searchParams.get("site"), env);
    if (!site || !isSlug(photo[1])) return json({ ok: false, error: "That photo could not be deleted." }, 400);
    const result = await callAccounts(env, request, `/v1/admin/listings/${photo[1]}/photos/${photo[2]}?site=${site}`, { method: "DELETE" });
    if (result.status < 400) invalidateCatalog(site);
    return json(result.body, result.status);
  }

  const photos = path.match(/^\/api\/admin\/listings\/([a-z0-9-]+)\/photos$/);
  if (photos && request.method === "POST") return uploadPhoto(request, env, photos[1]);
  if (photos && request.method === "PUT") return reorderPhotos(request, env, photos[1]);

  const one = path.match(/^\/api\/admin\/listings\/([a-z0-9-]+)$/);
  if (one && request.method === "GET") {
    const site = guideSite(url.searchParams.get("site"), env);
    if (!site) return json({ ok: false, error: "That guide is not valid." }, 400);
    const listing = (await visibleMerged(env, site)).find((item) => item.slug === one[1]);
    if (!listing) return json({ ok: false, error: "That listing was not found." }, 404);
    return json({ ok: true, listing: editorListing(listing, site) });
  }
  if (one && request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Send the listing as JSON." }, 400);
    }
    const site = guideSite(body.site, env);
    if (!site) return json({ ok: false, error: "That guide is not valid." }, 400);
    const current = (await visibleMerged(env, site)).find((item) => item.slug === one[1]);
    const logo = (current && current.logo) || "";
    const result = await callAccounts(env, request, `/v1/admin/listings/${one[1]}`, {
      method: "PUT",
      body: { ...body, site, logo },
    });
    if (result.status < 400) invalidateCatalog(site);
    return json(result.body, result.status);
  }
  if (one && request.method === "DELETE") {
    const site = guideSite(url.searchParams.get("site"), env);
    if (!site) return json({ ok: false, error: "That guide is not valid." }, 400);
    const result = await callAccounts(env, request, `/v1/admin/listings/${one[1]}?site=${site}`, { method: "DELETE" });
    if (result.status < 400) invalidateCatalog(site);
    return json(result.body, result.status);
  }

  return json({ ok: false, error: "Not found." }, 404);
}

async function uploadPhoto(request, env, slug) {
  if (!isSlug(slug)) return json({ ok: false, error: "That photo could not be saved." }, 400);
  let file;
  let site = "";
  let status = "live";
  const type = request.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    file = form.get("file");
    site = guideSite(form.get("site"), env);
    status = String(form.get("status") || "live");
  } else {
    return json({ ok: false, error: "Send the photo as a file." }, 400);
  }
  if (!site) return json({ ok: false, error: "That guide is not valid." }, 400);
  if (!file || typeof file.arrayBuffer !== "function") return json({ ok: false, error: "Choose a photo." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) {
    return json({ ok: false, error: "That file is too large. Keep each image under 5 MB." }, 400);
  }
  if (!sniffImage(bytes)) return json({ ok: false, error: "Use a JPEG, PNG, or WebP image." }, 400);
  const ready = await ensureRow(env, request, site, slug, status === "draft" ? "draft" : "live");
  if (!ready) return json({ ok: false, error: "Save the listing before adding photos." }, 400);
  const result = await accountsJson(await accountsFetch(env, `/v1/admin/listings/${slug}/photos?site=${site}`, {
    method: "POST",
    session: readCookie(request),
    bytes,
  }));
  if (result.status < 400) invalidateCatalog(site);
  return json(result.body, result.status);
}

async function reorderPhotos(request, env, slug) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Send the photos as JSON." }, 400);
  }
  const site = guideSite(body.site, env);
  if (!site || !isSlug(slug)) return json({ ok: false, error: "Those photos could not be reordered." }, 400);
  const ready = await ensureRow(env, request, site, slug, "live");
  if (!ready) return json({ ok: false, error: "Save the listing before reordering photos." }, 400);
  const result = await callAccounts(env, request, `/v1/admin/listings/${slug}/photos?site=${site}`, {
    method: "PUT",
    body: { site, photos: body.photos },
  });
  if (result.status < 400) invalidateCatalog(site);
  return json(result.body, result.status);
}

async function servePhoto(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, error: "Not found." }, 404);
  const id = new URL(request.url).pathname.split("/").pop() || "";
  if (!/^[a-f0-9-]{36}$/.test(id)) return json({ ok: false, error: "Not found." }, 404);
  const me = await accountsJson(await accountsFetch(env, "/v1/me", { session: readCookie(request) }));
  const admin = Boolean(me.body && me.body.user && me.body.user.isAdmin);
  if (!admin) {
    const merged = await mergedCatalog(env, siteId(env)).catch(() => []);
    const visible = liveListings(merged).some((listing) => (listing.photos || []).some((photo) => photo.id === id));
    if (!visible) return json({ ok: false, error: "Not found." }, 404);
  }
  const result = await accountsJson(await accountsFetch(env, `/v1/photos/${id}`));
  if (!result.bytes) return json({ ok: false, error: "Not found." }, 404);
  if (request.method === "HEAD") {
    return new Response(null, {
      headers: { "content-type": result.contentType || "application/octet-stream", "cache-control": admin ? "private, no-store" : "public, max-age=86400", "x-content-type-options": "nosniff" },
    });
  }
  return new Response(result.bytes, {
    headers: {
      "content-type": result.contentType || "application/octet-stream",
      "cache-control": admin ? "private, no-store" : "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
