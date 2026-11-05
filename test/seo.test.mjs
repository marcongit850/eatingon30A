import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { patchHtml, renderCard, renderProfile } from "../public-html.js";
import worker, {
  canonicalRedirect,
  directorySlashPath,
  legacyAmpersandRedirect,
  markNotFound,
  robotsTagForHost,
  stripFalseCanonical,
  trailingSlashRedirect,
  withHtmlCharset,
} from "../worker.js";

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
const manualSeoPages = new Set([
  join(root, "index.html"),
  join(root, "restaurants/tahona-tacos-and-tequileria-rosemary-beach/index.html"),
  join(root, "restaurants/louis-louis/index.html"),
  join(root, "restaurants/the-donut-hole-inlet-beach/index.html"),
  join(root, "guides/best-seafood-30a/index.html"),
]);
const skip30a = new Set([
  join(root, "restaurants/louis-louis/index.html"),
]);

for (const path of htmlPages) {
  const html = readFileSync(path, "utf8");
  const rel = path.slice(root.length);
  const title = attr(html, /<title>([^<]+)<\/title>/);
  const description = attr(html, /<meta name="description" content="([^"]+)">/);
  assert.equal(titles.has(title), false, "duplicate title " + title);
  assert.equal(descriptions.has(description), false, "duplicate description " + description);
  titles.add(title);
  descriptions.add(description);
  assert.ok(title.length >= 20 && title.length <= 60, rel + " title length " + title.length + " " + title);
  assert.equal(/\bNearby\b/.test(title), false, rel + " title uses Nearby " + title);
  assert.equal(/\bNearby\b/.test(description), false, rel + " description uses Nearby " + description);
  const manualSeo = manualSeoPages.has(path);
  if (manualSeo) {
    assert.ok(description.length >= 80 && description.length <= 160, rel + " description length " + description.length);
    if (!skip30a.has(path)) assert.match(description, /30A/);
  } else {
    assert.ok(description.length >= 110 && description.length <= 160, rel + " description length " + description.length);
    assert.match(description, /30A/);
    assert.match(description, /Walton County/);
  }
  const h1Text = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || ["", ""])[1].replace(/<[^>]+>/g, ""));
  assert.equal(/\bNearby\b/.test(h1Text), false, rel + " h1 uses Nearby " + h1Text);
  const listingPage = /restaurants\/[^/]+\/index\.html$/.test(rel);
  const noindexPage = /(?:^|\/)(?:404\.html|account\/|my-places\/|admin\/)/.test(rel);
  if (noindexPage) {
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.equal(html.includes("max-image-preview:large"), false, rel);
  } else {
    assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">/);
  }
  if (listingPage) {
    assert.equal(attr(html, /<meta property="og:type" content="([^"]+)">/), "restaurant.restaurant");
  }
  if (path.endsWith("404.html")) {
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.equal(html.includes('rel="canonical"'), false, "404 must not declare a canonical");
    assert.equal(html.includes("/404.html"), false, "404 must not point Google at /404.html");
    assert.equal(html.includes('property="og:url"'), false);
    const data = jsonLd(html);
    assert.equal(data["@context"], "https://schema.org");
    assert.equal(data.url, undefined);
    const h1s = html.match(/<h1[\s>]/g) || [];
    assert.equal(h1s.length, 1, rel + " h1 count");
    continue;
  }
  const canonical = attr(html, /<link rel="canonical" href="([^"]+)">/);
  assert.ok(canonical.startsWith(ORIGIN), rel + " canonical " + canonical);
  assert.equal(new URL(canonical).hostname, "www.eatingon30a.com", rel);
  assert.equal(canonical.includes("workers.dev"), false, rel);
  assert.equal(attr(html, /<meta property="og:title" content="([^"]+)">/), title);
  assert.equal(attr(html, /<meta property="og:description" content="([^"]+)">/), description);
  assert.equal(attr(html, /<meta property="og:url" content="([^"]+)">/), canonical);
  assert.equal(attr(html, /<meta property="og:site_name" content="([^"]+)">/), "Eating on 30A");
  assert.equal(attr(html, /<meta property="og:locale" content="([^"]+)">/), "en_US");
  if (!/restaurants\/[^/]+\/index\.html$/.test(rel)) {
    assert.equal(attr(html, /<meta property="og:type" content="([^"]+)">/), "website");
  }
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

const homeHtml = read("index.html");
assert.match(
  homeHtml,
  /<title>Best Restaurants on 30A \(2026\) \| Maps, Menus, Neighborhoods<\/title>/,
);
assert.match(
  homeHtml,
  /<meta name="description" content="Local picks from Rosemary Beach to Grayton\. Maps, menus, and every 30A neighborhood on Eating on 30A\.">/,
);
const home = jsonLd(homeHtml);
assert.deepEqual(home["@graph"].map((node) => node["@type"]), ["Organization", "WebSite", "ItemList"]);
assert.equal(home["@graph"][1].publisher["@id"], `${ORIGIN}/#organization`);

const directory = jsonLd(read("restaurants/index.html"));
const list = directory["@graph"].find((node) => node["@type"] === "ItemList");
assert.equal(list.numberOfItems, 155);
assert.equal(directory["@graph"].some((node) => node["@type"] === "BreadcrumbList"), true);
const directoryHtml = read("restaurants/index.html");
const directoryCards = directoryHtml.split('id="cards"')[1].split('id="browse-areas"')[0];
assert.equal((directoryCards.match(/class="card-link"/g) || []).length, 155);
assert.match(directoryCards, /href="\/restaurants\/o-ku-alys-beach\/"/);
assert.match(directoryCards, />O-Ku</);
assert.match(directoryHtml, /<h1 id="listing-title">Restaurants on 30A<\/h1>/);
assert.match(directoryHtml, /href="\/areas\/seaside\/"/);
assert.match(directoryHtml, /Scenic Highway 30A/);

const tahonaHtml = read("restaurants/tahona-tacos-and-tequileria-rosemary-beach/index.html");
assert.match(
  tahonaHtml,
  /<title>Tahona Tacos and Tequileria, Rosemary Beach \| Menu and Hours<\/title>/,
);
assert.match(
  tahonaHtml,
  /<meta name="description" content="Tacos, tequila, and hours at Tahona in Rosemary Beach\. See the listing on Eating on 30A\.">/,
);

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
assert.match(profileHtml, /width="\d+"/);
assert.match(profileHtml, /<img[^>]+loading="eager"/);
assert.match(read("restaurants/louis-louis/index.html"), /<title>Louis Louis Santa Rosa Beach: Waterfront Seafood and Hours<\/title>/);
assert.match(read("restaurants/the-donut-hole-inlet-beach/index.html"), /<title>The Donut Hole Inlet Beach: Hours, Menu and Breakfast on 30A<\/title>/);
assert.match(read("restaurants/the-donut-hole-inlet-beach/index.html"), /<h1>The Donut Hole Inlet Beach<\/h1>/);
assert.match(read("guides/best-seafood-30a/index.html"), /<title>Best Seafood on 30A: Where Locals Eat in 2026<\/title>/);
assert.match(profileHtml, /<h1>O-Ku<\/h1>/);
assert.equal(profileHtml.includes('class="place"'), false);
assert.match(profileHtml, /Scenic Highway 30A/);
assert.match(profileHtml, /href="\/areas\/alys-beach\/"/);
assert.equal(profileHtml.includes('aria-label="Related guides"'), false);
assert.equal(restaurant.aggregateRating, undefined);
assert.equal(restaurant.review, undefined);
assert.equal(restaurant.menu, undefined);
assert.equal(restaurant.hasMenu, undefined);
assert.equal(restaurant.openingHours, undefined);
assert.ok(Array.isArray(restaurant.openingHoursSpecification));
assert.ok(restaurant.openingHoursSpecification.some((row) => row.dayOfWeek.includes("Monday") && row.opens && row.closes));
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
assert.equal(missing.includes('rel="canonical"'), false);
assert.equal(missing.includes("/404.html"), false);
assert.equal(read("index.html").includes("noindex"), false);
assert.match(read("restaurants/index.html"), /<link rel="canonical" href="https:\/\/www\.eatingon30a\.com\/restaurants\/">/);

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
assert.equal(locs.some((url) => url.includes("%26") || url.includes("&")), false);
for (const dead of ["vue-on-30a", "brozinni-pizzeria", "pecan-jacks-gulf-place", "raw-&-juicy", "raw-%26-juicy"]) {
  assert.equal(locs.some((url) => url.includes(dead)), false, dead);
}
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

const shortMeta = {
  "angelinas-pizzeria-and-pasta-seagrove-beach": [60, 160],
  "basmatis-asian-cuisine-blue-mountain-beach": [60, 160],
  "don-pedros-mexican-restaurant": [60, 160],
  "edwards-fine-food-and-wine-rosemary-beach": [60, 160],
  "heavenlys-shortcakes-and-ice-cream-seaside": [60, 160],
  "cafe-thirty-a-seagrove-beach": [60, 160],
  "cajun-corner-sports-bar-and-grill": [60, 160],
  "mimmos-30a-blue-mountain-beach": [60, 160],
};
for (const [slug, [titleLimit, descLimit]] of Object.entries(shortMeta)) {
  const page = read(`restaurants/${slug}/index.html`);
  const title = attr(page, /<title>([^<]+)<\/title>/);
  const description = attr(page, /<meta name="description" content="([^"]+)">/);
  assert.ok(title.length <= titleLimit, `${slug} title ${title.length}: ${title}`);
  assert.ok(description.length <= descLimit, `${slug} description ${description.length}: ${description}`);
}

const mapHtml = read("map/index.html");
assert.match(mapHtml, /alt="Map of restaurants along Scenic Highway 30A"/);
for (const path of htmlPages) {
  const html = readFileSync(path, "utf8");
  for (const tag of html.matchAll(/<img\b[^>]*class="logo"[^>]*>/g)) {
    assert.match(tag[0], /\bwidth="/, path);
    assert.match(tag[0], /\bheight="/, path);
  }
}

const watersound = read("areas/watersound-origins/index.html");
const hiddenMarket = patchHtml(watersound, "/areas/watersound-origins/", {
  hidden: [{ slug: "village-market-cafe-bar-watersound-origins" }],
  placed: [],
});
const hiddenLd = jsonLd(hiddenMarket);
assert.equal(hiddenLd["@graph"].some((node) => node["@type"] === "WebSite"), true);
assert.equal(hiddenLd["@graph"].some((node) => node["@type"] === "Organization"), true);
assert.equal(hiddenLd["@graph"].some((node) => node["@type"] === "BreadcrumbList"), true);
const hiddenList = hiddenLd["@graph"].find((node) => node["@type"] === "ItemList");
assert.equal(hiddenList.itemListElement.some((item) => String(item.url).includes("village-market-cafe-bar")), false);
assert.equal(hiddenList.numberOfItems, hiddenList.itemListElement.length);

const reddCard = renderCard({
  slug: "redds-pub",
  name: "Redd’s Pub",
  area: "Nearby",
  areaSlug: "nearby",
  subarea: "US 98",
  photos: [{ src: "/images/restaurants/redds-pub/02.jpg" }],
});
assert.match(reddCard, /src="\/images\/restaurants\/redds-pub\/02\.jpg"/);
assert.match(reddCard, /width="600"/);
assert.match(reddCard, /height="434"/);
const redBarPage = renderProfile({
  slug: "the-red-bar-grayton-beach",
  name: "The Red Bar",
  area: "Grayton Beach",
  areaSlug: "grayton-beach",
  photos: [{ src: "/images/restaurants/the-red-bar-grayton-beach/01.jpg" }],
}, []);
assert.match(redBarPage, /src="\/images\/restaurants\/the-red-bar-grayton-beach\/01\.jpg"[^>]*width="1600" height="1200"/);

const slashRestaurants = trailingSlashRedirect(new URL("https://www.eatingon30a.com/restaurants"));
assert.equal(slashRestaurants.status, 301);
assert.equal(slashRestaurants.headers.get("location"), "https://www.eatingon30a.com/restaurants/");
const slashMap = trailingSlashRedirect(new URL("https://www.eatingon30a.com/map?area=seaside"));
assert.equal(slashMap.status, 301);
assert.equal(slashMap.headers.get("location"), "https://www.eatingon30a.com/map/?area=seaside");
const slashListing = trailingSlashRedirect(new URL("https://www.eatingon30a.com/restaurants/salty-butcher"));
assert.equal(slashListing.status, 301);
assert.equal(slashListing.headers.get("location"), "https://www.eatingon30a.com/restaurants/salty-butcher/");
assert.equal(trailingSlashRedirect(new URL("https://www.eatingon30a.com/restaurants/charlies-delights")).headers.get("location"), "https://www.eatingon30a.com/restaurants/charlies-delights/");
assert.equal(trailingSlashRedirect(new URL("https://www.eatingon30a.com/restaurants/")), null);
assert.equal(trailingSlashRedirect(new URL("https://www.eatingon30a.com/styles.css")), null);
assert.equal(trailingSlashRedirect(new URL("https://www.eatingon30a.com/sitemap.xml")), null);
assert.equal(trailingSlashRedirect(new URL("https://www.eatingon30a.com/restaurants/salty-butcher"), "POST"), null);
assert.equal(trailingSlashRedirect(new URL("https://www.eatingon30a.com/includes/header")), null);
assert.equal(trailingSlashRedirect(new URL("https://www.eatingon30a.com/includes/footer")), null);
assert.equal(trailingSlashRedirect(new URL("https://www.eatingon30a.com/includes/header.html")), null);
assert.equal(trailingSlashRedirect(new URL("https://www.eatingon30a.com/includes/footer.html")), null);
assert.equal(directorySlashPath("/restaurants/index.html"), "/restaurants/");
assert.equal(directorySlashPath("/includes/header"), "");
assert.equal(directorySlashPath("/includes/footer"), "");
assert.equal(directorySlashPath("/includes/header.html"), "");
const apexDirectory = canonicalRedirect(new URL("https://eatingon30a.com/restaurants"));
assert.equal(apexDirectory.status, 301);
assert.equal(apexDirectory.headers.get("location"), "https://www.eatingon30a.com/restaurants/");
const apexMap = canonicalRedirect(new URL("https://eatingon30a.com/map"));
assert.equal(apexMap.headers.get("location"), "https://www.eatingon30a.com/map/");
const apexInclude = canonicalRedirect(new URL("https://eatingon30a.com/includes/header"));
assert.equal(apexInclude.status, 301);
assert.equal(apexInclude.headers.get("location"), "https://www.eatingon30a.com/includes/header");
const plainHtml = withHtmlCharset(new Response("<html></html>", { headers: { "content-type": "text/html" } }));
assert.equal(plainHtml.headers.get("content-type"), "text/html; charset=utf-8");
const already = withHtmlCharset(new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }));
assert.equal(already.headers.get("content-type"), "text/html; charset=utf-8");
const jpeg = withHtmlCharset(new Response("x", { headers: { "content-type": "image/jpeg" } }));
assert.equal(jpeg.headers.get("content-type"), "image/jpeg");

const apex = canonicalRedirect(new URL("https://eatingon30a.com/restaurants/o-ku-alys-beach/?q=sushi"));
assert.equal(apex.status, 301);
assert.equal(apex.headers.get("location"), "https://www.eatingon30a.com/restaurants/o-ku-alys-beach/?q=sushi");
const apexAccount = canonicalRedirect(new URL("https://eatingon30a.com/account/"));
assert.equal(apexAccount.status, 301);
assert.equal(apexAccount.headers.get("location"), "https://www.eatingon30a.com/account/");
assert.equal(canonicalRedirect(new URL("https://eatingon30a.com/api/listing"), "POST"), null);
assert.equal(canonicalRedirect(new URL("https://eatingon30a.com/api/account/saves"), "PUT"), null);
assert.equal(canonicalRedirect(new URL("https://eatingon30a.com/api/account/saves"), "put"), null);
const apexPagePost = canonicalRedirect(new URL("https://eatingon30a.com/account/"), "POST");
assert.equal(apexPagePost.status, 308);
assert.equal(apexPagePost.headers.get("location"), "https://www.eatingon30a.com/account/");
const apexApiGet = canonicalRedirect(new URL("https://eatingon30a.com/api/account/me"), "GET");
assert.equal(apexApiGet.status, 301);
assert.equal(apexApiGet.headers.get("location"), "https://www.eatingon30a.com/api/account/me");
assert.equal(canonicalRedirect(new URL("https://www.eatingon30a.com/")), null);
assert.equal(canonicalRedirect(new URL("https://www.eatingon30a.com/api/listing"), "POST"), null);
assert.equal(canonicalRedirect(new URL("https://eatingon30a.352marc.workers.dev/restaurants/")), null);
assert.equal(robotsTagForHost("eatingon30a.352marc.workers.dev"), "noindex");
assert.equal(robotsTagForHost("www.eatingon30a.com"), "");
assert.equal(canonicalRedirect(new URL("https://www.eatingon30a.com/restaurants/?meal=Dinner")), null);
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/?meal=Dinner")), null);

const encodedAmp = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/raw-%26-juicy/"));
assert.equal(encodedAmp.status, 301);
assert.equal(encodedAmp.headers.get("location"), "https://www.eatingon30a.com/restaurants/raw-and-juicy-alys-beach/");
const literalAmp = legacyAmpersandRedirect(new URL("https://eatingon30a.com/restaurants/beach-&-brew-on-30a"));
assert.equal(literalAmp.status, 301);
assert.equal(literalAmp.headers.get("location"), "https://eatingon30a.com/restaurants/beach-and-brew-on-30a-seacrest/");
assert.equal(canonicalRedirect(new URL("https://eatingon30a.com/restaurants/raw-%26-juicy/")).headers.get("location"), "https://www.eatingon30a.com/restaurants/raw-%26-juicy/");
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/closed-%26-cafe/")), null);
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/vue-on-30a/")), null);
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/salty-butcher/")), null);
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/charlies-delights/")), null);
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/blue-mabel-smokehouse-%26-provisions/")), null);

const summer = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/the-summer-kitchen-cafe"));
assert.equal(summer.status, 301);
assert.equal(summer.headers.get("location"), "https://www.eatingon30a.com/restaurants/the-summer-kitchen-cafe-rosemary-beach/");
const curlyPickle = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/pickle%E2%80%99s-burger-and-shake/"));
assert.equal(curlyPickle.status, 301);
assert.equal(curlyPickle.headers.get("location"), "https://www.eatingon30a.com/restaurants/pickles-burger-and-shake-seaside/");
const accentCafe = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/caf%C3%A9-thirty-a"));
assert.equal(accentCafe.status, 301);
assert.equal(accentCafe.headers.get("location"), "https://www.eatingon30a.com/restaurants/cafe-thirty-a-seagrove-beach/");
const bud = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/bud-%26-alley%E2%80%99s/"));
assert.equal(bud.status, 301);
assert.equal(bud.headers.get("location"), "https://www.eatingon30a.com/restaurants/bud-and-alleys-seaside/");
const market = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/seagrove-village-market-caf%C3%A9"));
assert.equal(market.status, 301);
assert.equal(market.headers.get("location"), "https://www.eatingon30a.com/areas/seagrove-beach/");
const explore = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/explore30a"));
assert.equal(explore.status, 301);
assert.equal(explore.headers.get("location"), "https://www.eatingon30a.com/");
const terms = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/terms-and-conditions/"));
assert.equal(terms.status, 301);
assert.equal(terms.headers.get("location"), "https://www.eatingon30a.com/about/");
const grayton = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/grayton-seafood-co."));
assert.equal(grayton.status, 301);
assert.equal(grayton.headers.get("location"), "https://www.eatingon30a.com/restaurants/grayton-seafood-co-grayton-beach/");
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/raw-%26-juicy/"), "POST"), null);

const lacoTarget = "https://www.eatingon30a.com/restaurants/laco-seacrest/";
for (const path of [
  "/restaurants/la-cocina-seacrest",
  "/restaurants/la-cocina-seacrest/",
  "/restaurants/la-cocina-seacrest/index.html",
  "/restaurants/la-cocina",
  "/restaurants/la-cocina/",
  "/restaurants/la-cocina/index.html",
]) {
  const moved = legacyAmpersandRedirect(new URL(`https://www.eatingon30a.com${path}`));
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get("location"), lacoTarget);
}
const lacoQuery = legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/la-cocina-seacrest?ref=old"));
assert.equal(lacoQuery.headers.get("location"), `${lacoTarget}?ref=old`);
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/laco-seacrest/")), null);
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/laco-seacrest")), null);
assert.equal(legacyAmpersandRedirect(new URL("https://www.eatingon30a.com/restaurants/la-cocina-seacrest/"), "POST"), null);
const lacoBare = trailingSlashRedirect(new URL("https://www.eatingon30a.com/restaurants/laco-seacrest"));
assert.equal(lacoBare.status, 301);
assert.equal(lacoBare.headers.get("location"), lacoTarget);

for (const path of ["/restaurants/growler-garage-30a", "/restaurants/growler-garage-30a/"]) {
  const growler = legacyAmpersandRedirect(new URL(`https://www.eatingon30a.com${path}`));
  assert.equal(growler.status, 301);
  assert.equal(growler.headers.get("location"), "https://www.eatingon30a.com/restaurants/growler-garage-30a-dune-allen-beach/");
}
for (const path of [
  "/restaurants/idyll-hounds-proper",
  "/restaurants/idyll-hounds-proper/",
  "/restaurants/idyll-hounds-proper-inlet-beach",
  "/restaurants/idyll-hounds-proper-inlet-beach/",
]) {
  const proper = legacyAmpersandRedirect(new URL(`https://www.eatingon30a.com${path}`));
  assert.equal(proper.status, 301);
  assert.equal(proper.headers.get("location"), "https://www.eatingon30a.com/restaurants/proper-restaurant-and-bar-inlet-beach/");
}

const stale404 = `<!DOCTYPE html><head><link rel="canonical" href="https://www.eatingon30a.com/404.html"><meta property="og:url" content="https://www.eatingon30a.com/404.html"><script type="application/ld+json">{"@type": "WebPage", "url": "https://www.eatingon30a.com/404.html", "name": "Page not found"}</script></head>`;
const cleaned = stripFalseCanonical(stale404);
assert.equal(cleaned.includes("/404.html"), false);
assert.equal(cleaned.includes('rel="canonical"'), false);
const notFound = await markNotFound(new Response(stale404, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }));
assert.equal(notFound.status, 404);
assert.equal(notFound.headers.get("x-robots-tag"), "noindex");
assert.equal((await notFound.text()).includes("/404.html"), false);
const kept = await markNotFound(new Response("<link rel=\"canonical\" href=\"https://www.eatingon30a.com/restaurants/\">", { status: 200, headers: { "content-type": "text/html" } }));
assert.equal(kept.status, 200);
assert.equal(kept.headers.get("x-robots-tag"), null);

const missingPage = await worker.fetch(new Request("https://www.eatingon30a.com/restaurants/vue-on-30a/"), {
  ASSETS: {
    async fetch() {
      return new Response(stale404, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    },
  },
});
assert.equal(missingPage.status, 404);
assert.equal(missingPage.headers.get("x-robots-tag"), "noindex");
assert.equal((await missingPage.text()).includes('rel="canonical"'), false);

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
    // The Meta noscript pixel is a 1x1 tracking image, not page content.
    if (tag.includes("https://www.facebook.com/tr?") && tag.includes("noscript=1")) continue;
    const alt = tag.match(/\salt="([^"]*)"/);
    assert.ok(alt, "missing alt " + path);
    // The 360 thumbnail is decorative. The link text next to it is the accessible name.
    if (tag.includes("/images/30a-360.webp") && alt[1] === "") continue;
    assert.ok(alt[1].trim().length > 0, "empty alt " + path);
  }
}
