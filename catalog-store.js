/**
 * Baseline listings are data/catalog.json, written by scripts/build.py.
 * Admin rows come from the accounts Worker and override that baseline per guide.
 * The bundled file is this Worker's own guide. The other guide's baseline is
 * that site's public /data/catalog.json, fetched by this Worker. The browser
 * never calls the other origin.
 */

import baselineCatalog from "./data/catalog.json" with { type: "json" };
import { mergeCatalog } from "./catalog.js";
import { accountsFetch, accountsJson, siteId } from "./shared-accounts.js";

const GUIDE_ORIGINS = {
  "30a": "https://www.eatingon30a.com",
  destin: "https://www.eatingindestin.com",
};

const GUIDE_LABELS = {
  "30a": "Eating on 30A",
  destin: "Eating in Destin",
};

const cache = new Map();
const remoteCache = new Map();
const TTL_MS = 2000;
const REMOTE_TTL_MS = 60000;

export class SisterCatalogError extends Error {
  constructor(site) {
    const label = GUIDE_LABELS[site] || "That guide";
    super(`The ${label} listings could not be loaded. Try again in a moment.`);
    this.name = "SisterCatalogError";
  }
}

// The file bundled with this Worker belongs to ACCOUNT_SITE. Tests that omit
// the env use the 30A catalog shipped in this package.
export function usesLocalBaseline(env, site) {
  const local = siteId(env);
  if (local) return site === local;
  return site === "30a";
}

export function baselineFor(site, env) {
  if (usesLocalBaseline(env, site)) return baselineCatalog;
  return [];
}

export function invalidateCatalog(site) {
  if (site) {
    cache.delete(site);
    remoteCache.delete(site);
  } else {
    cache.clear();
    remoteCache.clear();
  }
}

export async function loadOverrides(env, site, { fresh = false } = {}) {
  const key = site || "";
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  if (!env || !env.ACCOUNTS_SHARED_SECRET || !site) {
    cache.set(key, { at: Date.now(), rows: [] });
    return [];
  }
  const response = await accountsFetch(env, `/v1/catalog?site=${encodeURIComponent(site)}`);
  const result = await accountsJson(response);
  const rows = result.body && result.body.ok && Array.isArray(result.body.listings) ? result.body.listings : [];
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

function catalogFetcher(env) {
  if (env && typeof env.CATALOG_FETCH === "function") return env.CATALOG_FETCH;
  return fetch;
}

async function loadRemoteBaseline(env, site) {
  const origin = GUIDE_ORIGINS[site];
  if (!origin) throw new SisterCatalogError(site);
  const hit = remoteCache.get(site);
  if (hit && Date.now() - hit.at < REMOTE_TTL_MS) return hit.rows;
  let response;
  try {
    response = await catalogFetcher(env)(`${origin}/data/catalog.json`, {
      headers: {
        accept: "application/json",
        "user-agent": "EatingGuides catalog",
      },
    });
  } catch (error) {
    console.log(JSON.stringify({ event: "sister_catalog", site, message: error && error.message }));
    throw new SisterCatalogError(site);
  }
  const type = response && response.headers && response.headers.get("content-type") || "";
  if (!response || !response.ok || !type.includes("json")) {
    console.log(JSON.stringify({ event: "sister_catalog", site, status: response && response.status }));
    throw new SisterCatalogError(site);
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    console.log(JSON.stringify({ event: "sister_catalog", site, message: error && error.message }));
    throw new SisterCatalogError(site);
  }
  if (!Array.isArray(data)) throw new SisterCatalogError(site);
  const rows = data.filter((item) => item && typeof item.slug === "string" && item.slug && typeof item.name === "string" && item.name);
  remoteCache.set(site, { at: Date.now(), rows });
  return rows;
}

export async function guideBaseline(env, site) {
  if (usesLocalBaseline(env, site)) return baselineCatalog;
  return loadRemoteBaseline(env, site);
}

export async function mergedCatalog(env, site, options) {
  const rows = await loadOverrides(env, site, options);
  const baseline = await guideBaseline(env, site);
  return mergeCatalog(baseline, rows);
}

export async function currentCatalog(env, options) {
  const site = siteId(env);
  return { site, merged: await mergedCatalog(env, site, options) };
}
