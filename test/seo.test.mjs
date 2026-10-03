import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalRedirect, robotsTagForHost } from "../worker.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "site.config.json"), "utf8"));
const ORIGIN = config.origin.replace(/\/$/, "");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function decode(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

function attr(html, pattern) {
  const match = html.match(pattern);
  assert.ok(match, pattern.toString());
  return decode(match[1]);
}

function jsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1, "expected one JSON-LD block");
  return JSON.parse(blocks[0][1]);
}

function hasType(node, type) {
  const value = node && node["@type"];
  return value === type || (Array.isArray(value) && value.includes(type));
}

function typed(graph, type) {
  return graph.find((node) => hasType(node, type));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "vendor" || name === ".wrangler") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const htmlPages = walk(root).filter((path) => path.endsWith(".html") && !path.includes(`${join(root, "includes")}`));
const titles = new Set();
const descriptions = new Set();

for (const path of htmlPages) {
  const html = readFileSync(path, "utf8");
  const rel = path.slice(root.length);
  const title = attr(html, /<title>([^<]+)<\/title>/);
  const description = attr(html, /<meta name="description" content="([^"]+)">/);
  assert.equal(titles.has(title), false, "duplicate title " + title);
  assert.equal(descriptions.has(description), false, "duplicate description " + description);
  titles.add(title);
  descriptions.add(description);
  assert.ok(title.length >= 20 && title.length <= 70, rel + " title length " + title.length + " " + title);
  assert.ok(description.length >= 110 && description.length <= 165, rel + " description length " + description.length);
  assert.match(description, /30A/);
  assert.match(description, /Walton County/);
  const canonical = attr(html, /<link rel="canonical" href="([^"]+)">/);
  assert.ok(canonical.startsWith(ORIGIN), rel + " canonical " + canonical);
  assert.equal(new URL(canonical).hostname, "www.eatingon30a.com", rel);
  assert.equal(canonical.includes("workers.dev"), false, rel);
  assert.equal(attr(html, /<meta property="og:title" content="([^"]+)">/), title);
  assert.equal(attr(html, /<meta property="og:description" content="([^"]+)">/), description);
  assert.equal(attr(html, /<meta property="og:url" content="([^"]+)">/), canonical);
  assert.equal(attr(html, /<meta property="og:site_name" content="([^"]+)">/), "Eating on 30A");
  assert.equal(attr(html, /<meta property="og:locale" content="([^"]+)">/), "en_US");
  assert.equal(attr(html, /<meta property="og:type" content="([^"]+)">/), "website");
  const image = attr(html, /<meta property="og:image" content="([^"]+)">/);
  assert.ok(image.startsWith("https://"), rel);
  assert.equal(attr(html, /<meta name="twitter:card" content="([^"]+)">/), "summary_large_image");
  assert.equal(attr(html, /<meta name="twitter:title" content="([^"]+)">/), title);
  assert.equal(attr(html, /<meta name="twitter:description" content="([^"]+)">/), description);
  assert.equal(attr(html, /<meta name="twitter:image" content="([^"]+)">/), image);
  const imageAlt = attr(html, /<meta property="og:image:alt" content="([^"]+)">/);
  assert.ok(imageAlt.length > 10, rel);
  assert.equal(attr(html, /<meta name="twitter:image:alt" content="([^"]+)">/), imageAlt);
  assert.ok(attr(html, /<meta property="og:image:width" content="([^"]+)">/));
  const data = jsonLd(html);
  assert.equal(data["@context"], "https://schema.org");
  const h1s = html.match(/<h1[\s>]/g) || [];
  assert.equal(h1s.length, 1, rel + " h1 count");
}

const home = jsonLd(read("index.html"));
assert.deepEqual(home["@graph"].map((node) => node["@type"]), ["Organization", "WebSite", "ItemList"]);
assert.equal(home["@graph"][1].publisher["@id"], `${ORIGIN}/#organization`);

const directory = jsonLd(read("restaurants/index.html"));
const list = directory["@graph"].find((node) => node["@type"] === "ItemList");
assert.equal(list.numberOfItems, 155);
assert.equal(directory["@graph"].some((node) => node["@type"] === "BreadcrumbList"), true);
const directoryHtml = read("restaurants/index.html");
assert.match(directoryHtml, /<h1 id="listing-title">Restaurants on 30A<\/h1>/);
assert.match(directoryHtml, /href="\/areas\/seaside\/"/);
assert.match(directoryHtml, /Scenic Highway 30A/);

const profileHtml = read("restaurants/o-ku-alys-beach/index.html");
const profile = jsonLd(profileHtml);
const restaurant = typed(profile["@graph"], "Restaurant");
assert.equal(restaurant.name, "O-Ku");
assert.ok(hasType(restaurant, "LocalBusiness"));
assert.equal(restaurant.url, `${ORIGIN}/restaurants/o-ku-alys-beach/`);
assert.equal(restaurant.address.addressCountry, "US");
assert.ok(restaurant.address.streetAddress);
assert.equal(restaurant.areaServed.name, "Alys Beach");
assert.equal(restaurant.containedInPlace.url, `${ORIGIN}/areas/alys-beach/`);
assert.ok(restaurant.servesCuisine.includes("Japanese"));
assert.equal(typeof restaurant.geo.latitude, "number");
assert.equal(typeof restaurant.geo.longitude, "number");
assert.ok(restaurant.telephone);
assert.equal(profile["@graph"].some((node) => node["@type"] === "BreadcrumbList"), true);
const crumbs = typed(profile["@graph"], "BreadcrumbList");
assert.deepEqual(crumbs.itemListElement.map((item) => item.name), ["Home", "Restaurants", "Alys Beach", "O-Ku"]);
assert.match(restaurant.image, /\/images\/restaurants\/o-ku-alys-beach\/01\.jpg$/);
assert.match(profileHtml, /<title>O-Ku \| Japanese in Alys Beach, 30A<\/title>/);
assert.match(profileHtml, /<h1>O-Ku<\/h1>/);
assert.equal(profileHtml.includes('class="place"'), false);
assert.match(profileHtml, /Scenic Highway 30A/);
assert.match(profileHtml, /href="\/areas\/alys-beach\/"/);
assert.equal(profileHtml.includes('aria-label="Related guides"'), false);
assert.equal(restaurant.aggregateRating, undefined);
assert.equal(restaurant.review, undefined);
assert.equal(restaurant.openingHours, undefined);
assert.equal(restaurant.openingHoursSpecification, undefined);
const profilePage = typed(profile["@graph"], "WebPage");
assert.equal(profilePage.mainEntity["@id"], restaurant["@id"]);
assert.equal(profilePage.url, restaurant.url);

const redHtml = read("restaurants/the-red-bar-grayton-beach/index.html");
assert.match(redHtml, /<title>The Red Bar \| American in Grayton Beach, 30A<\/title>/);
assert.match(redHtml, /<h1>The Red Bar<\/h1>/);
assert.equal(redHtml.includes('class="place"'), false);
assert.equal(redHtml.includes("Other locations"), false);
assert.equal(redHtml.includes('aria-label="Related guides"'), false);
assert.match(redHtml, /iconic 30A spot/);
assert.equal(redHtml.includes("Hours, address, and map are on the profile."), false);
assert.match(redHtml, /href="\/areas\/grayton-beach\/"/);
assert.match(redHtml, /Also in Grayton Beach/);
assert.match(redHtml, /href="\/restaurants\/ajs-grayton-beach-grayton-beach\/"/);
assert.match(redHtml, /href="\/restaurants\/black-bear-bread-co-grayton-beach\/"/);
assert.match(redHtml, /href="\/restaurants\/borago-grayton-beach\/"/);
assert.match(redHtml, /href="\/restaurants\/cajun-corner-sports-bar-and-grill\/"/);
const redSchema = typed(jsonLd(redHtml)["@graph"], "Restaurant");
assert.equal(redSchema.telephone, "(850) 231-1008");
assert.deepEqual(redSchema.servesCuisine, ["American"]);
assert.match(redSchema.image, /\/images\/restaurants\/the-red-bar-grayton-beach\/01\.jpg$/);
assert.equal(redSchema.aggregateRating, undefined);

const amavidaHtml = read("restaurants/amavida-coffee-roasters-seaside/index.html");
assert.match(amavidaHtml, /<title>Amavida Coffee Roasters \| Cafe in Seaside, 30A<\/title>/);
assert.match(amavidaHtml, /<h1>Amavida Coffee Roasters<\/h1>/);
assert.equal(amavidaHtml.includes("Other locations"), false);
assert.equal(amavidaHtml.includes('aria-label="Related guides"'), false);

const pigHtml = read("restaurants/the-perfect-pig-watercolor/index.html");
assert.match(pigHtml, /<h1>The Perfect Pig<\/h1>/);
assert.equal(pigHtml.includes("Other locations"), false);
assert.match(pigHtml, /serves Southern food/);
assert.match(pigHtml, /Also in WaterColor/);

const styles = read("styles.css");
assert.equal(styles.includes(".profile-head h1 .place"), false);
assert.match(styles, /\.profile-story p \+ p/);

const steam = jsonLd(read("restaurants/steamboat-grill-30a-seagrove-beach/index.html"));
const steamRestaurant = typed(steam["@graph"], "Restaurant");
assert.match(steamRestaurant.image, /\/images\/restaurants\/steamboat-grill-30a-seagrove-beach\/01\.jpg$/);

const happy = jsonLd(read("restaurants/beach-happy-cafe-seagrove-beach/index.html"));
const happyRestaurant = typed(happy["@graph"], "Restaurant");
assert.match(happyRestaurant.image, /\/images\/restaurants\/beach-happy-cafe-seagrove-beach\/01\.jpg$/);

const stinkys = jsonLd(read("restaurants/stinkys-fish-camp-dune-allen-beach/index.html"));
const stinkysRestaurant = typed(stinkys["@graph"], "Restaurant");
assert.match(stinkysRestaurant.image, /\/images\/restaurants\/stinkys-fish-camp-dune-allen-beach\/01\.jpg$/);

const seasideHtml = read("areas/seaside/index.html");
const town = jsonLd(seasideHtml);
assert.equal(town["@graph"].some((node) => node["@type"] === "ItemList"), true);
assert.equal(town["@graph"].some((node) => node["@type"] === "BreadcrumbList"), true);
assert.equal(typed(town["@graph"], "Place").name, "Seaside");
assert.match(seasideHtml, /<h1 class="town-title">Restaurants in Seaside<\/h1>/);
assert.match(seasideHtml, /Find restaurants in Seaside on Scenic Highway 30A/);
assert.match(seasideHtml, /href="\/areas\/watercolor\/"/);
assert.match(seasideHtml, /href="\/areas\/seagrove-beach\/"/);

const missing = read("404.html");
assert.match(missing, /noindex/);
assert.equal(read("index.html").includes("noindex"), false);

const robots = read("robots.txt");
assert.match(robots, /User-agent: \*\nAllow: \/\n/);
assert.equal(robots.includes("Disallow"), false);
assert.match(robots, new RegExp(`Sitemap: ${ORIGIN.replaceAll(".", "\\.")}/sitemap\\.xml`));
assert.match(robots, new RegExp(`${ORIGIN.replaceAll(".", "\\.")}/llms\\.txt`));
assert.match(robots, new RegExp(`${ORIGIN.replaceAll(".", "\\.")}/llms-full\\.txt`));
for (const agent of [
  "Googlebot",
  "Bingbot",
  "GPTBot",
  "ChatGPT-User",
  "Google-Extended",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "meta-externalagent",
  "FacebookBot",
]) {
  assert.match(robots, new RegExp(`User-agent: ${agent}\\nAllow: /\\n`), agent);
}

const sitemap = read("sitemap.xml");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.equal(locs.includes(`${ORIGIN}/`), true);
assert.equal(locs.includes(`${ORIGIN}/restaurants/`), true);
assert.equal(locs.includes(`${ORIGIN}/restaurants/o-ku-alys-beach/`), true);
assert.equal(locs.includes(`${ORIGIN}/404.html`), false);
assert.equal(locs.includes(`${ORIGIN}/guides/`), true);
for (const slug of [
  "best-seafood-30a",
  "breakfast-30a",
  "coffee-brunch-30a",
  "kid-friendly-30a",
  "dinner-seaside",
  "rosemary-beach-restaurants",
  "watercolor-restaurants",
  "walkable-30a",
  "laurens-favorites-30a",
  "nearby-us-98",
]) {
  assert.equal(locs.includes(`${ORIGIN}/guides/${slug}/`), true, slug);
}
assert.equal(locs.filter((url) => url.includes("/guides/")).length, 11);
assert.equal(locs.includes(`${ORIGIN}/list-your-restaurant/`), true);
assert.equal(locs.length, 7 + 11 + 14 + 155);
assert.match(sitemap, new RegExp(`<loc>${ORIGIN.replaceAll(".", "\\.")}/areas/seaside/</loc>\\s*<lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
assert.equal(sitemap.includes("workers.dev"), false);

const apex = canonicalRedirect(new URL("https://eatingon30a.com/restaurants/o-ku-alys-beach/?q=sushi"));
assert.equal(apex.status, 301);
assert.equal(apex.headers.get("location"), "https://www.eatingon30a.com/restaurants/o-ku-alys-beach/?q=sushi");
const apexPost = canonicalRedirect(new URL("https://eatingon30a.com/api/listing"), "POST");
assert.equal(apexPost.status, 308);
assert.equal(apexPost.headers.get("location"), "https://www.eatingon30a.com/api/listing");
assert.equal(canonicalRedirect(new URL("https://www.eatingon30a.com/")), null);
assert.equal(canonicalRedirect(new URL("https://eatingon30a.352marc.workers.dev/restaurants/")), null);
assert.equal(robotsTagForHost("eatingon30a.352marc.workers.dev"), "noindex");
assert.equal(robotsTagForHost("www.eatingon30a.com"), "");

const llms = read("llms.txt");
const llmsFull = read("llms-full.txt");
assert.ok(llmsFull.length > llms.length);
for (const url of [`${ORIGIN}/`, `${ORIGIN}/restaurants/`, `${ORIGIN}/map/`, `${ORIGIN}/areas/`, `${ORIGIN}/guides/`, `${ORIGIN}/guides/best-seafood-30a/`, `${ORIGIN}/guides/breakfast-30a/`, `${ORIGIN}/guides/coffee-brunch-30a/`, `${ORIGIN}/guides/kid-friendly-30a/`, `${ORIGIN}/guides/dinner-seaside/`, `${ORIGIN}/guides/rosemary-beach-restaurants/`, `${ORIGIN}/guides/watercolor-restaurants/`, `${ORIGIN}/guides/walkable-30a/`, `${ORIGIN}/guides/laurens-favorites-30a/`, `${ORIGIN}/guides/nearby-us-98/`, `${ORIGIN}/about/`, `${ORIGIN}/contact/`, `${ORIGIN}/list-your-restaurant/`, `${ORIGIN}/sitemap.xml`, `${ORIGIN}/restaurants/o-ku-alys-beach/`]) {
  assert.ok(llms.includes(url), "llms.txt missing " + url);
  assert.ok(llmsFull.includes(url), "llms-full.txt missing " + url);
}
assert.equal(llms.includes("<"), false);
assert.equal(llmsFull.includes("<"), false);

for (const path of walk(root)) {
  if (!path.endsWith(".html") && path !== join(root, "site.js")) continue;
  const html = readFileSync(path, "utf8");
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = match[0];
    const alt = tag.match(/\salt="([^"]*)"/);
    assert.ok(alt, "missing alt " + path);
    assert.ok(alt[1].trim().length > 0, "empty alt " + path);
  }
}
