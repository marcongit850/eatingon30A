/**
 * Baseline listings are data/catalog.json, written by scripts/build.py.
 * Admin rows come from the accounts Worker and override that baseline per guide.
 */

import baselineCatalog from "./data/catalog.json" with { type: "json" };
import { mergeCatalog } from "./catalog.js";
import { accountsFetch, accountsJson, siteId } from "./shared-accounts.js";

const cache = new Map();
const TTL_MS = 2000;

export function baselineFor(site) {
  if (site === "30a") return baselineCatalog;
  return [];
}

export function invalidateCatalog(site) {
  if (site) cache.delete(site);
  else cache.clear();
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

export async function mergedCatalog(env, site, options) {
  const rows = await loadOverrides(env, site, options);
  return mergeCatalog(baselineFor(site), rows);
}

export async function currentCatalog(env, options) {
  const site = siteId(env);
  return { site, merged: await mergedCatalog(env, site, options) };
}
