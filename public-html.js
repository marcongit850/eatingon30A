/**
 * Patch built HTML, the sitemap, and llms.txt so a draft or deleted listing
 * disappears everywhere a crawler or a visitor would see it. Live edits replace
 * the built card in place. A new live listing is added to the directory, its
 * town page, and the guides it matches.
 */

import siteConfig from "./site.config.json" with { type: "json" };

const ORIGIN = String(siteConfig.origin || "https://www.eatingon30a.com").replace(/\/$/, "");
const WALKABLE = new Set(["seaside", "alys-beach", "rosemary-beach"]);
const MONOGRAM_SKIP = new Set(["the", "and", "at", "of", "a", "an", "by", "for", "on", "in"]);

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

export function normalizeHtmlPath(pathname) {
  let path = pathname || "/";
  if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
  if (!path.endsWith("/")) path += "/";
  return path;
}

export function listingSlugFromPath(pathname) {
  const match = String(pathname || "").match(/^\/restaurants\/([a-z0-9-]+)(?:\/index\.html|\/)?$/);
  if (!match || match[1] === "index") return "";
  return match[1];
}

export function isCatalogPath(pathname) {
  if (pathname === "/data/restaurants.json" || pathname === "/sitemap.xml") return true;
  if (pathname === "/llms.txt" || pathname === "/llms-full.txt") return true;
  if (pathname === "/" || pathname === "/index.html") return true;
  if (pathname === "/map" || pathname === "/map/" || pathname === "/map/index.html") return true;
  if (pathname === "/restaurants" || pathname === "/restaurants/" || pathname === "/restaurants/index.html") return true;
  if (listingSlugFromPath(pathname)) return true;
  if (pathname.startsWith("/areas/") || pathname.startsWith("/guides/")) return true;
  return false;
}

function snippet(text, limit = 150) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit).replace(/\s+\S*$/, "");
  return `${cut.replace(/[.,;:]$/, "")}…`;
}

function monogram(name) {
  const cleaned = String(name || "").replace(/[’']/g, "").replace(/&/g, " ");
  let words = (cleaned.match(/[A-Za-z0-9]+/g) || []).filter((word) => !MONOGRAM_SKIP.has(word.toLowerCase()));
  if (!words.length) words = String(name || "").match(/[A-Za-z0-9]+/g) || ["E"];
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}

function toneFor(listing) {
  const blob = [...(listing.cuisines || []), ...(listing.foods || []), listing.category || ""].join(" ").toLowerCase();
  if (/coffee|cafe|donut/.test(blob)) return "coffee";
  if (/dessert|ice cream|chocolate|sweet/.test(blob)) return "sweet";
  if (/pizza|italian/.test(blob)) return "italian";
  if (/sushi|japanese/.test(blob)) return "sushi";
  if (/seafood|oyster|fish/.test(blob)) return "seafood";
  if (blob.includes("burger")) return "burger";
  if (/mexican|taco|latin/.test(blob)) return "spice";
  if (/wine|bar/.test(blob)) return "wine";
  return "gulf";
}

function shotLabel(listing) {
  if (listing.foods && listing.foods.length) return listing.foods[0];
  if (listing.cuisines && listing.cuisines.length) return listing.cuisines[0];
  return listing.area || "";
}

function placeholder(tone, label, name, hidden = false) {
  const flag = hidden ? " hidden" : "";
  return `<div class="ph" data-tone="${escapeHtml(tone)}"${flag}><span class="mono" aria-hidden="true">${escapeHtml(monogram(name || label))}</span><span class="ph-label">${escapeHtml(label)}</span></div>`;
}

function photoAlt(listing) {
  if (listing.areaSlug === "nearby") {
    return `${listing.name} in ${listing.area} on ${listing.subarea || "US 98"}, near Scenic Highway 30A`;
  }
  return `${listing.name} in ${listing.area} on Scenic Highway 30A`;
}

function yesNo(flag) {
  return flag ? "yes" : "no";
}

export function renderCard(listing) {
  const meals = (listing.meals || []).join(" · ");
  const cuisines = (listing.cuisines || []).join(", ");
  const bits = [listing.price, cuisines, meals].filter(Boolean);
  const areaLine = listing.subarea ? `${listing.area} · ${listing.subarea}` : listing.area;
  const note = snippet(listing.notes);
  const noteHtml = note ? `<p class="note">${escapeHtml(note)}</p>` : "";
  const image = listing.photos && listing.photos[0] ? listing.photos[0].src : "";
  const tone = toneFor(listing);
  const label = shotLabel(listing);
  let media;
  let mediaClass = "card-media";
  if (image) {
    media = `<img src="${escapeHtml(image)}" alt="${escapeHtml(photoAlt(listing))}" loading="lazy" onerror="var p=this.parentElement;this.remove();var f=p&&p.querySelector('.ph');if(f)f.hidden=false">${placeholder(tone, label, listing.name, true)}`;
  } else if (listing.logo) {
    mediaClass = "card-media logo-media";
    media = `<img class="card-logo" src="${escapeHtml(listing.logo)}" alt="${escapeHtml(listing.name)} logo" loading="lazy">`;
  } else {
    media = placeholder(tone, label, listing.name);
  }
  const attrs = [
    `id="r-${escapeHtml(listing.slug)}"`,
    'class="card"',
    `data-area="${escapeHtml(listing.areaSlug)}"`,
    `data-meals="${escapeHtml((listing.meals || []).join("|"))}"`,
    `data-cuisines="${escapeHtml((listing.cuisines || []).join("|"))}"`,
    `data-outdoor="${yesNo(listing.outdoor)}"`,
    `data-kids="${yesNo(listing.kids)}"`,
    `data-music="${yesNo(listing.music)}"`,
    `data-reservations="${yesNo(listing.reservations)}"`,
    `data-groups="${yesNo(listing.groups)}"`,
    `data-happyfood="${yesNo(listing.happyFood)}"`,
    `data-happydrinks="${yesNo(listing.happyDrinks)}"`,
    `data-laurens-favorite="${yesNo(listing.laurensFavorite)}"`,
    `data-search="${escapeHtml([listing.name, listing.area, listing.subarea, listing.label, ...(listing.cuisines || []), ...(listing.meals || []), ...(listing.foods || []), listing.category, listing.notes, listing.price].filter(Boolean).join(" ").toLowerCase())}"`,
  ].join(" ");
  const saveArea = listing.label || listing.area;
  return `<article ${attrs}><a class="card-link" href="/restaurants/${escapeHtml(listing.slug)}/"><div class="${mediaClass}">${media}</div><div class="card-body"><p class="card-area">${escapeHtml(areaLine)}</p><h2>${escapeHtml(listing.name)}</h2><p class="meta">${escapeHtml(bits.join(" · "))}</p>${noteHtml}</div></a><div class="save-slot" data-slug="${escapeHtml(listing.slug)}" data-name="${escapeHtml(listing.name)}" data-area="${escapeHtml(saveArea)}"></div></article>`;
}

export function guideSlugsFor(listing) {
  const guides = [];
  if ((listing.cuisines || []).includes("Seafood")) guides.push("best-seafood-30a");
  if ((listing.meals || []).includes("Breakfast")) guides.push("breakfast-30a");
  if ((listing.cuisines || []).includes("Cafe")) guides.push("coffee-brunch-30a");
  if (listing.kids) guides.push("kid-friendly-30a");
  if (listing.areaSlug === "seaside" && (listing.meals || []).includes("Dinner")) guides.push("dinner-seaside");
  if (listing.areaSlug === "rosemary-beach") guides.push("rosemary-beach-restaurants");
  if (listing.areaSlug === "watercolor") guides.push("watercolor-restaurants");
  if (WALKABLE.has(listing.areaSlug)) guides.push("walkable-30a");
  if (listing.laurensFavorite) guides.push("laurens-favorites-30a");
  if (listing.areaSlug === "nearby") guides.push("nearby-us-98");
  return guides;
}

export function pageAcceptsListing(pathname, listing) {
  const path = normalizeHtmlPath(pathname);
  if (path === "/restaurants/") return true;
  if (path === `/areas/${listing.areaSlug}/`) return true;
  const guide = path.match(/^\/guides\/([a-z0-9-]+)\/$/);
  if (!guide || guide[1] === "index") return false;
  return guideSlugsFor(listing).includes(guide[1]);
}

function divBounds(html, openIndex) {
  const openEnd = html.indexOf(">", openIndex);
  if (openEnd < 0) return null;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = openEnd + 1;
  let depth = 1;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return { innerEnd: match.index, end: match.index + match[0].length };
  }
  return null;
}

function articleBounds(html, slug) {
  const id = `id="r-${slug}"`;
  const at = html.indexOf(id);
  if (at < 0) return null;
  const open = html.lastIndexOf("<article", at);
  const end = html.indexOf("</article>", at);
  if (open < 0 || end < 0) return null;
  return { open, end: end + "</article>".length };
}

function removeArticles(html, slugs) {
  let next = html;
  for (const slug of slugs) {
    const bounds = articleBounds(next, slug);
    if (!bounds) continue;
    next = next.slice(0, bounds.open) + next.slice(bounds.end);
  }
  return next;
}

function replaceArticle(html, listing) {
  const bounds = articleBounds(html, listing.slug);
  if (!bounds) return html;
  return html.slice(0, bounds.open) + renderCard(listing) + html.slice(bounds.end);
}

function eachCover(html, visit) {
  const finder = /<div class="cover" data-featured/g;
  let result = "";
  let cursor = 0;
  let match;
  while ((match = finder.exec(html))) {
    const bounds = divBounds(html, match.index);
    if (!bounds) return html;
    const chunk = html.slice(match.index, bounds.end);
    result += html.slice(cursor, match.index);
    result += visit(chunk);
    cursor = bounds.end;
    finder.lastIndex = bounds.end;
  }
  return result + html.slice(cursor);
}

function coverSlug(chunk) {
  const match = chunk.match(/\/restaurants\/([a-z0-9-]+)\//);
  return match ? match[1] : "";
}

function renderCover(listing, hidden) {
  const image = listing.photos && listing.photos[0] ? listing.photos[0].src : "";
  const tone = toneFor(listing);
  const media = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(photoAlt(listing))}" loading="eager" onerror="var p=this.parentElement;this.remove();var f=p&&p.querySelector('.ph');if(f)f.hidden=false">${placeholder(tone, shotLabel(listing), listing.name, true)}`
    : placeholder(tone, shotLabel(listing), listing.name);
  const meta = [listing.label || listing.area, listing.price, (listing.cuisines || []).join(", ")].filter(Boolean).join(" · ");
  const flag = hidden ? " hidden" : "";
  return `<div class="cover" data-featured${flag}><a class="cover-media" href="/restaurants/${escapeHtml(listing.slug)}/">${media}</a><div class="cover-copy"><p class="kicker">Featured</p><h2>${escapeHtml(listing.name)}</h2><p class="lede">${escapeHtml(snippet(listing.notes, 240))}</p><p class="meta">${escapeHtml(meta)}</p><p><a class="text-link" href="/restaurants/${escapeHtml(listing.slug)}/">View restaurant</a></p></div></div>`;
}

function gridMarker(pathname) {
  const path = normalizeHtmlPath(pathname);
  if (path === "/restaurants/") return '<div id="cards" class="card-grid">';
  if (path.startsWith("/areas/") || /^\/guides\/[a-z0-9-]+\/$/.test(path)) return '<div class="card-grid">';
  return "";
}

function appendCards(html, pathname, listings) {
  const marker = gridMarker(pathname);
  if (!marker || !listings.length) return html;
  const at = html.indexOf(marker);
  if (at < 0) return html;
  const bounds = divBounds(html, at);
  if (!bounds) return html;
  const cards = listings.map(renderCard).join("");
  return html.slice(0, bounds.innerEnd) + cards + html.slice(bounds.innerEnd);
}

function stripListItems(html, slugs) {
  let next = html;
  for (const slug of slugs) {
    const url = `${ORIGIN}/restaurants/${slug}/`;
    const pattern = new RegExp(`\\{"@type": "ListItem", "position": \\d+, "name": "(?:\\\\.|[^"\\\\])*", "url": "${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\},?`, "g");
    next = next.replace(pattern, "");
  }
  return next;
}

function stripAnchors(html, slugs) {
  let next = html;
  for (const slug of slugs) {
    const pattern = new RegExp(`<a class="map-hit" href="/restaurants/${slug}/">[\\s\\S]*?</a>`, "g");
    next = next.replace(pattern, "");
  }
  return next;
}

export function patchHtml(html, pathname, { hidden = [], placed = [] } = {}) {
  const hiddenSlugs = hidden.map((listing) => listing.slug);
  const placedBySlug = new Map(placed.map((listing) => [listing.slug, listing]));
  let next = removeArticles(html, hiddenSlugs);
  next = stripAnchors(next, hiddenSlugs);
  next = stripListItems(next, hiddenSlugs);
  next = eachCover(next, (chunk) => {
    const slug = coverSlug(chunk);
    if (hiddenSlugs.includes(slug)) return "";
    const listing = placedBySlug.get(slug);
    if (!listing) return chunk;
    return renderCover(listing, /\shidden[\s>]/.test(chunk.slice(0, 80)));
  });
  const insert = [];
  for (const listing of placed) {
    if (!articleBounds(next, listing.slug)) {
      if (pageAcceptsListing(pathname, listing)) insert.push(listing);
      continue;
    }
    if (pageAcceptsListing(pathname, listing)) next = replaceArticle(next, listing);
    else next = removeArticles(next, [listing.slug]);
  }
  if (insert.length) next = appendCards(next, pathname, insert);
  return next;
}

function liveSitemapListing(listing) {
  const slug = String(listing.slug || "");
  return slug && !slug.includes("&") && !slug.includes("%26");
}

export function patchSitemap(xml, { hidden = [], placed = [] } = {}) {
  const refresh = new Set([...hidden, ...placed].map((listing) => listing.slug));
  let next = xml;
  for (const slug of refresh) {
    const loc = `${ORIGIN}/restaurants/${slug}/`;
    next = next.replace(new RegExp(`\\s*<url>\\s*<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>[\\s\\S]*?</url>`, "g"), "");
  }
  const urls = placed.filter(liveSitemapListing).map((listing) => `  <url>\n    <loc>${escapeHtml(`${ORIGIN}/restaurants/${listing.slug}/`)}</loc>\n  </url>`).join("\n");
  if (urls) next = next.replace("</urlset>", `${urls}\n</urlset>`);
  next = next.replace(/\s*<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = (block.match(/<loc>([^<]*)<\/loc>/) || [])[1] || "";
    if (loc.includes("%26") || loc.includes("&")) return "";
    return block;
  });
  return next;
}

export function patchLlms(text, { hidden = [], placed = [] } = {}) {
  const refresh = new Set([...hidden, ...placed].map((listing) => listing.slug));
  const lines = text.split("\n").filter((line) => {
    for (const slug of refresh) {
      if (line.includes(`/restaurants/${slug}/`)) return false;
    }
    return true;
  });
  const extra = placed.map((listing) => {
    const bits = (listing.cuisines || []).join(", ") || listing.category || "Restaurant";
    return `- [${listing.name}](${ORIGIN}/restaurants/${listing.slug}/): ${listing.address || listing.area}. ${bits}.`;
  });
  const index = lines.findIndex((line) => line.startsWith("## Towns"));
  if (index >= 0) lines.splice(index, 0, ...extra);
  else lines.push(...extra);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function telHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return digits ? `tel:${digits}` : "";
}

function hostOf(url) {
  return String(url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function paragraphs(text) {
  const blocks = String(text || "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return blocks.map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`).join("");
}

function gallery(listing) {
  const photos = listing.photos || [];
  if (!photos.length) return `<div class="profile-hero">${placeholder(toneFor(listing), shotLabel(listing), listing.name)}</div>`;
  const tiles = photos.map((photo, index) => {
    const hidden = index >= 4 ? " hidden" : "";
    const loading = index < 4 ? "eager" : "lazy";
    const fallback = index === 0
      ? ` onerror="var p=this.parentElement;this.remove();var f=p&&p.querySelector('.ph');if(f)f.hidden=false">${placeholder(toneFor(listing), shotLabel(listing), listing.name, true)}`
      : ">";
    return `<figure class="profile-gallery-tile"${hidden}><img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photoAlt(listing))}" loading="${loading}"${fallback}</figure>`;
  }).join("");
  const noun = photos.length === 1 ? "photo" : "photos";
  const shown = Math.min(4, photos.length);
  return `<div class="profile-gallery" data-total="${photos.length}"><div class="profile-gallery-stage"><div class="profile-gallery-grid">${tiles}</div></div><p class="profile-gallery-count" aria-live="polite">${shown} of ${photos.length} ${noun}</p><hr class="profile-gallery-rule"></div>`;
}

export function renderProfile(listing, nearby = []) {
  const chips = [];
  for (const meal of listing.meals || []) chips.push(`<li><a href="/restaurants/?meal=${escapeHtml(meal)}">${escapeHtml(meal)}</a></li>`);
  for (const cuisine of listing.cuisines || []) chips.push(`<li><a href="/restaurants/?cuisine=${escapeHtml(cuisine)}">${escapeHtml(cuisine)}</a></li>`);
  if (listing.price) chips.push(`<li>${escapeHtml(listing.price)}</li>`);
  const flags = [];
  if (listing.outdoor) flags.push("Outdoor dining");
  if (listing.kids) flags.push("Kid friendly");
  if (listing.music) flags.push("Live music*");
  if (listing.laurensFavorite) flags.push("Lauren’s Favorites");
  if (listing.happyDrinks) flags.push("Happy hour drinks");
  if (listing.happyFood) flags.push("Happy hour food");
  if (listing.reservations) flags.push("Takes reservations");
  if (listing.groups) flags.push("Good for groups 12+");
  for (const flag of flags) chips.push(`<li>${escapeHtml(flag)}</li>`);
  const phone = telHref(listing.phone) ? `<a href="${escapeHtml(telHref(listing.phone))}">${escapeHtml(listing.phone)}</a>` : "";
  const website = listing.website ? `<a href="${escapeHtml(listing.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostOf(listing.website))}</a>` : "";
  const directions = listing.lat != null && listing.lng != null
    ? `<a href="https://www.openstreetmap.org/?mlat=${listing.lat}&amp;mlon=${listing.lng}#map=17/${listing.lat}/${listing.lng}">View map</a>`
    : "";
  const socials = [];
  if (listing.instagram) socials.push(`<a href="${escapeHtml(listing.instagram)}" rel="noopener noreferrer">Instagram</a>`);
  if (listing.facebook) socials.push(`<a href="${escapeHtml(listing.facebook)}" rel="noopener noreferrer">Facebook</a>`);
  const facts = [
    ["Hours", listing.hours ? escapeHtml(listing.hours).replace(/\n/g, "<br>") : ""],
    ["Phone", phone],
    ["Website", website],
    ["Address", listing.address ? escapeHtml(listing.address) : ""],
    ["Directions", directions],
    ["Food", escapeHtml((listing.foods || []).join(", "))],
    ["Vibe", escapeHtml((listing.vibes || []).join(", "))],
    ["Category", escapeHtml(listing.category || "")],
    ["Also", socials.join(" · ")],
  ].filter(([, value]) => value).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join("");
  const also = nearby.filter((item) => item.slug !== listing.slug && item.areaSlug === listing.areaSlug).slice(0, 4);
  const alsoHtml = also.map((item) => `<a class="map-hit" href="/restaurants/${escapeHtml(item.slug)}/"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.price || "")}</span></a>`).join("");
  const image = listing.photos && listing.photos[0] ? listing.photos[0].src : "";
  const title = `${listing.name} in ${listing.area}`;
  const description = snippet(`${listing.name} in ${listing.area} on Scenic Highway 30A, Walton County, Florida. ${listing.notes || ""}`.trim(), 160);
  const path = `/restaurants/${listing.slug}/`;
  const map = listing.lat != null && listing.lng != null
    ? `<div class="wrap profile-map"><div id="detail-map" data-lat="${listing.lat}" data-lng="${listing.lng}" data-name="${escapeHtml(listing.name)}" data-slug="${escapeHtml(listing.slug)}" data-area="${escapeHtml(listing.area)}" data-address="${escapeHtml(listing.address)}" data-image="${escapeHtml(image)}" role="region" aria-label="Map"></div><link rel="stylesheet" href="/vendor/leaflet/leaflet.css"><script src="/vendor/leaflet/leaflet.js"></script></div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | Eating on 30A</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(ORIGIN + path)}">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#102825">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div id="site-header"></div>
<main id="main">
<article class="profile">${gallery(listing)}<div class="wrap profile-head"><p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/restaurants/">Restaurants</a> <span aria-hidden="true">/</span> <a href="/areas/${escapeHtml(listing.areaSlug)}/">${escapeHtml(listing.area)}</a> <span aria-hidden="true">/</span> ${escapeHtml(listing.name)}</p><p class="eyebrow"><a href="/areas/${escapeHtml(listing.areaSlug)}/">${escapeHtml(listing.area)}</a>${listing.price ? ` · ${escapeHtml(listing.price)}` : ""}${listing.category ? ` · ${escapeHtml(listing.category)}` : ""}</p><h1>${escapeHtml(listing.name)}</h1><ul class="chips">${chips.join("")}</ul></div><div class="wrap profile-grid"><div class="prose profile-story">${paragraphs(listing.notes) || `<p>${escapeHtml(listing.name)} is in ${escapeHtml(listing.area)}.</p>`}</div><aside><dl class="facts">${facts}</dl></aside></div>${map}<section class="wrap more"><h2>Also in ${escapeHtml(listing.area)}</h2><div class="map-list">${alsoHtml}</div><p><a class="text-link" href="/areas/${escapeHtml(listing.areaSlug)}/">All restaurants in ${escapeHtml(listing.area)}</a></p></section></article>
</main>
<div id="site-footer"></div>
<script src="/header.js"></script>
<script src="/footer.js"></script>
<script type="module" src="/site.js"></script>
</body>
</html>`;
}

export function changedListings(merged) {
  const hidden = [];
  const placed = [];
  for (const listing of merged) {
    if (listing.source === "baseline") continue;
    if (listing.deleted || listing.status !== "live") hidden.push(listing);
    else placed.push(listing);
  }
  return { hidden, placed };
}
