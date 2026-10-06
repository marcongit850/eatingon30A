/**
 * Apply the listing overlay when a public page, the map data, the sitemap,
 * or llms.txt is requested. With no admin rows, the built file is returned
 * unchanged.
 */

import { liveListings, publicRecords } from "./catalog.js";
import { currentCatalog } from "./catalog-store.js";
import { siteId } from "./shared-accounts.js";
import {
  changedListings,
  isCatalogPath,
  listingSlugFromPath,
  patchHtml,
  patchLlms,
  patchSitemap,
  renderProfile,
} from "./public-html.js";

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function notFound(request, env) {
  const url = new URL(request.url);
  if (env && env.ASSETS) {
    const page = await env.ASSETS.fetch(new Request(new URL("/404.html", url.origin)));
    const headers = new Headers(page.headers);
    headers.set("cache-control", "no-store");
    return new Response(page.body, { status: 404, headers });
  }
  return htmlResponse("That page is not on the menu.", 404);
}

export async function servePublic(request, response, env) {
  const url = new URL(request.url);
  if (!isCatalogPath(url.pathname)) return response;
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  if (!siteId(env)) return response;
  let merged;
  try {
    merged = (await currentCatalog(env)).merged;
  } catch (error) {
    console.log(JSON.stringify({ event: "catalog_overlay", message: error && error.message }));
    return response;
  }
  const { hidden, placed } = changedListings(merged);
  if (!hidden.length && !placed.length) return response;

  const slug = listingSlugFromPath(url.pathname);
  if (slug) {
    const listing = merged.find((item) => item.slug === slug);
    if (!listing || listing.deleted || listing.status !== "live") return notFound(request, env);
    if (listing.source === "baseline") return response;
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    return htmlResponse(renderProfile(listing, liveListings(merged)));
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers: { "cache-control": "no-store" } });
  }

  if (url.pathname === "/data/restaurants.json") {
    return new Response(`${JSON.stringify(publicRecords(merged), null, 2)}\n`, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const text = await response.text();
  if (url.pathname === "/sitemap.xml") {
    return new Response(patchSitemap(text, { hidden, placed }), {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (url.pathname === "/llms.txt" || url.pathname === "/llms-full.txt") {
    return new Response(patchLlms(text, { hidden, placed }), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response(patchHtml(text, url.pathname, { hidden, placed }), {
    status: response.status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
