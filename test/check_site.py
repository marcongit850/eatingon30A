#!/usr/bin/env python3
"""Checks the generated static site against the CSV source."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build  # noqa: E402

restaurants = json.loads((ROOT / "data" / "restaurants.json").read_text(encoding="utf-8"))
source = build.load_restaurants()
home = (ROOT / "index.html").read_text(encoding="utf-8")
directory = (ROOT / "restaurants" / "index.html").read_text(encoding="utf-8")
sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
wrangler = (ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
site_js = (ROOT / "site.js").read_text(encoding="utf-8")
styles = (ROOT / "styles.css").read_text(encoding="utf-8")

failures = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


shown = build.published_restaurants()
check(len(source) == 114, f"full CSV should stay at 114 published rows, got {len(source)}")
check(len(restaurants) == len(shown) == 114, "public json should include every published restaurant")
detail_pages = list((ROOT / "restaurants").glob("*/index.html"))
check(len(detail_pages) == len(restaurants), f"generated {len(detail_pages)} detail pages for {len(restaurants)} rows")
check("not on the site yet" not in home and "Design preview" not in home, "homepage should not say the catalog is still a sample")
check("full restaurant CSV" not in home.lower(), "homepage should not say the CSV is withheld")
check("<h1>Where to eat<br> on 30A.</h1>" in home, "homepage headline should say where to eat on 30A")
build_src = (ROOT / "scripts" / "build.py").read_text(encoding="utf-8")
check(build_src.count("def build_detail(") == 1, "restaurant profiles should come from one template function")
check(build_src.count("def card(") == 1, "directory cards should come from one template function")
check('"name": "eatingon30a"' in wrangler, "worker name must stay eatingon30a")
check("eatingon30a.com" not in wrangler, "wrangler must not attach the vanity domain")
check("routes" not in wrangler, "wrangler must not declare custom routes")

for meal in ("Breakfast", "Lunch", "Dinner", "Desserts", "Drinks"):
    check(f'href="/restaurants/?meal={meal}"' in home, f"homepage missing meal link {meal}")

areas = json.loads((ROOT / "data" / "locations.json").read_text(encoding="utf-8"))
check(len(areas) == len({item["areaSlug"] for item in restaurants}), f"town pages should match listed areas, got {len(areas)}")
for area in areas:
    check(f'href="/restaurants/?area={area["slug"]}"' in home, f"homepage missing area filter {area['slug']}")
    check((ROOT / "areas" / area["slug"] / "index.html").exists(), f"missing town page {area['slug']}")

for restaurant in restaurants:
    path = ROOT / "restaurants" / restaurant["slug"] / "index.html"
    check(path.exists(), f"missing detail page {restaurant['slug']}")
    check(f"/restaurants/{restaurant['slug']}/" in directory, f"directory missing {restaurant['slug']}")
    check(f"{build.ORIGIN}/restaurants/{restaurant['slug']}/" in sitemap, f"sitemap missing {restaurant['slug']}")
    page = path.read_text(encoding="utf-8")
    check(f"<h1>{build.e(restaurant['name'])}</h1>" in page, f"detail h1 missing {restaurant['name']}")
    check('class="profile"' in page and 'class="profile-hero"' in page, f"detail page left the shared profile template {restaurant['slug']}")
    check("maps.googleapis" not in page and "airtable" not in page.lower(), f"detail page calls a paid API {restaurant['slug']}")

check(f"Sitemap: {build.ORIGIN}/sitemap.xml" in robots, "robots missing sitemap")
check("User-agent: *" in robots and "Allow: /" in robots, "robots should allow crawlers")
missing_coords = [item["slug"] for item in restaurants if not isinstance(item.get("lat"), (int, float)) or not isinstance(item.get("lng"), (int, float)) or not item.get("address")]
check(not missing_coords, f"listings missing address or coordinates: {missing_coords}")
photos = [item for item in restaurants if item.get("image")]
check(len(photos) == 1 and photos[0]["slug"] == "stinkys-fish-camp-dune-allen-beach", f"expected one cached restaurant photo, got {[item['slug'] for item in photos]}")
check(build.local_listing_photo("o-ku-alys-beach") is None, "a slug without a dropped file should stay a monogram")
readme = (ROOT / "README.md").read_text(encoding="utf-8")
check("re-export the Wix CMS" in readme and "images/restaurants/" in readme, "README should say how to add the missing photos")
check("popup-address" in site_js and "markerPopup" in site_js, "map popups should include the street address")
pin_rule = styles.split(".leaflet-marker-icon.pin", 1)
check(len(pin_rule) == 2 and "background:" in pin_rule[1][:400], "map pins must paint a fill on Leaflet's marker class")
check(".leaflet-div-icon.pin" not in styles, "pin styles must not depend on the class Leaflet drops")
about = (ROOT / "about" / "index.html").read_text(encoding="utf-8")
for banned in ("CSV files", "Google Places", "OpenStreetMap tiles", "monogram in a set frame"):
    check(banned not in about, f"about page still mentions {banned}")
check("editorial" not in about.lower(), "about should not call the site an editorial guide")
check("CSV" not in about and "OpenStreetMap" not in about and "Google Places" not in about, "about should stay free of build talk")
check("a feel for the place" in about and "Dune Allen" in about and "Watersound Origins" in about, "about page should keep the visitor guide and the towns")
check("See the restaurants" in about and "Open the directory" not in about, "about button should invite visitors in")
check("Find breakfast, lunch, and dinner along Scenic Highway 30A" in home, "homepage hero should welcome visitors to 30A")
check("editorial" not in home.lower() and "already filtered" not in home, "homepage should not sound like a product or an editorial")
check("a feel for the place" in home, "homepage essay should use the visitor guide")
areas_index = (ROOT / "areas" / "index.html").read_text(encoding="utf-8")
check("Towns along the highway" in areas_index, "towns page heading should introduce the coast")
check("Open a town for the restaurants there" in areas_index, "towns page should point visitors to the restaurants there")
check("7 Restaurants" in areas_index and "7 places" not in areas_index, "town cards should count Restaurants")
check("7 Restaurants" in home and re.search(r"\bplaces\b", home) is None, "homepage town counts should say Restaurants")
check(build.restaurant_count_word(1, label=True) == "Restaurant", "a single listing is a Restaurant label")
check(build.restaurant_count_word(7) == "restaurants", "sentence counts stay lowercase")
check("1 restaurant on the map" in site_js and "restaurants on the map" in site_js, "map count should say restaurants")
check("place on the map" not in site_js, "map count should not say place")
check("filter" not in areas_index.lower() and "directory" not in areas_index.lower(), "towns page should not explain the directory")
dune = (ROOT / "areas" / "dune-allen-beach" / "index.html").read_text(encoding="utf-8")
check("Show 7 Restaurants" in dune, "Dune Allen should label its count as Restaurants")
check("Gulf Place" in (ROOT / "areas" / "gulf-place" / "index.html").read_text(encoding="utf-8"), "Gulf Place stays a place name")
for area_page in (ROOT / "areas").glob("*/index.html"):
    text = area_page.read_text(encoding="utf-8")
    check("Watch a short clip" not in text, f"{area_page.parent.name} still has a clip sentence")
    check(re.search(r"\bplaces\b", text) is None, f"{area_page.parent.name} still says places")
    check("youtube.com" not in text and "youtu.be" not in text, f"{area_page.parent.name} still links to YouTube")
    check("<h1>" in text and 'class="lede"' in text and 'class="card-grid"' in text, f"{area_page.parent.name} lost the town page")
config = json.loads((ROOT / "site.config.json").read_text(encoding="utf-8"))
featured = config.get("featured") or []
by_slug = {item["slug"]: item for item in restaurants}
check(featured == [
    "stinkys-fish-camp-dune-allen-beach",
    "the-red-bar-grayton-beach",
    "bud-and-alleys-seaside",
    "cafe-thirty-a-seagrove-beach",
], "featured cover should keep Stinky's plus three other listings")
check(len(set(by_slug[slug]["areaSlug"] for slug in featured)) == len(featured), "featured listings should use different towns")
check({"$$", "$$$"} <= {by_slug[slug]["price"] for slug in featured}, "featured mix should include casual and upscale")
check(home.count('<div class="cover" data-featured') == len(featured), "homepage should render every featured cover")
check("86400000" in home and "from-the-guide" in home, "homepage should rotate the cover by UTC day")
check(home.count('class="kicker">From the guide') == len(featured), "each featured cover keeps the same kicker")
check('aria-label="Previous featured"' in home and 'aria-label="Next featured"' in home, "featured arrows need accessible names")
check('data-featured-step="-1"' in home and 'data-featured-step="1"' in home, "featured arrows should step through the list")
check('class="cover-controls" hidden' in home, "featured arrows stay hidden until the page script runs")
check("stepFeatured" in site_js and "data-featured-step" in site_js, "page script should cycle the featured cover")
check("mapListCard" in site_js and "map-thumb" in site_js and "openPopup" in site_js, "map list should use compact cards and still open the pin")
check("#map-list .map-hit" in styles and "#map-list .map-thumb" in styles, "map list cards should stay compact")
check(".cover-arrow" in styles and "min-width: 44px" in styles, "featured arrows should stay large enough to tap")
for slug in featured:
    check(f'/restaurants/{slug}/' in home, f"homepage cover missing {slug}")
    check("Read the profile" in home, "featured cover should link to the profile")
llms = (ROOT / "llms.txt").read_text(encoding="utf-8")
check("CSV" not in llms and "custom domain" not in llms, "llms.txt should stay visitor-facing")
check("https://eatingon30a.352marc.workers.dev" in (ROOT / "site.config.json").read_text(encoding="utf-8"), "public origin should be the current workers.dev host")
check("openstreetmap.org" in site_js, "map tiles must be OpenStreetMap")
check("OpenStreetMap" in (ROOT / "map" / "index.html").read_text(encoding="utf-8"), "map page missing OpenStreetMap")
check("leaflet.js" in (ROOT / "map" / "index.html").read_text(encoding="utf-8"), "map page missing Leaflet")
check("googlePlaceId" not in json.dumps(restaurants), "public json leaked place ids")

big_bad = next(item for item in restaurants if item["slug"] == "big-bad-breakfast-inlet-beach")
card = re.search(r'id="r-big-bad-breakfast-inlet-beach"[^>]*>', directory)
check(card is not None, "missing Big Bad Breakfast card")
if card:
    tag = card.group(0)
    check('data-area="inlet-beach"' in tag, "Big Bad Breakfast area filter data")
    check("Breakfast" in tag and "Lunch" in tag, "Big Bad Breakfast meal data")

stinkys = (ROOT / "restaurants" / "stinkys-fish-camp-dune-allen-beach" / "index.html").read_text(encoding="utf-8")
check("/images/restaurants/stinkys-fish-camp.jpg" in stinkys, "Stinky's should use the compressed photo")
check("/images/restaurants/stinkys-fish-camp-logo.jpg" in stinkys, "Stinky's logo should be a local file")
check("static.wixstatic.com" not in stinkys, "Stinky's profile should not hotlink Wix for its photos")
oku = (ROOT / "restaurants" / "o-ku-alys-beach" / "index.html").read_text(encoding="utf-8")
oku_hero = oku.split('class="profile-hero"', 1)[1].split('class="wrap profile-head"', 1)[0]
check('class="ph"' in oku_hero and 'class="mono"' in oku_hero, "a listing without a photo should keep the monogram")
check("<img" not in oku_hero, "O-Ku hero should stay a monogram")
check("Black%20Heart" not in directory and "heart" not in stinkys.lower() or "stinkys-fish-camp.jpg" in stinkys, "heart placeholder should not be the photo")
check("static.wixstatic.com" in home, "town photos should use the working Wix image URLs")

shared_header = (ROOT / "includes" / "header.html").read_text(encoding="utf-8")
shared_footer = (ROOT / "includes" / "footer.html").read_text(encoding="utf-8")
check('href="/restaurants/"' in shared_header and 'href="/map/"' in shared_header, "shared header is missing nav links")
check('href="/areas/"' in shared_header and 'href="/about/"' in shared_header, "shared header is missing town or about links")
check('href="/contact/"' in shared_footer and "site-footer" in shared_footer, "shared footer is missing links")
check(
    'src="/images/eating-on-30a-logo.png"' in shared_header and 'alt="Eating on 30A"' in shared_header,
    "header should use the Eating on 30A logo",
)
check("<em>Eating</em>" not in shared_header, "header should not keep the text wordmark")
check('class="footer-mark"' in shared_footer and 'src="/images/eating-on-30a-logo.png"' in shared_footer, "footer should use the Eating on 30A logo")
check('alt="Eating on 30A"' in shared_footer and "<em>Eating</em>" not in shared_footer, "footer logo needs alt text")
check("logo.svg" not in shared_header and "logo.svg" not in shared_footer and not (ROOT / "logo.svg").exists(), "the masthead file should stay out of the site")
check((ROOT / "images" / "eating-on-30a-logo.png").is_file(), "transparent logo file should be in images")
check("brand-logo" not in styles and "subscribe-band" in styles and "subscribe-popup" in styles, "subscribe styles should stay in place")
check("Yes, I want coupons!" in shared_footer and 'name="email"' in shared_footer, "footer subscribe is missing the coupon fields")
check(">Local<" in shared_footer and ">Visitor<" in shared_footer, "footer subscribe should offer Local and Visitor")
check('id="subscribe-popup"' in shared_footer and "Exclusive restaurant coupons" in shared_footer, "coupon popup and footer headline")
subscribe_js = (ROOT / "subscribe.js").read_text(encoding="utf-8")
check("30000" in subscribe_js and "localStorage" in subscribe_js, "popup should wait 30s and remember dismiss in localStorage")
worker_js = (ROOT / "worker.js").read_text(encoding="utf-8")
check("CONTACT_EMAIL" in worker_js and "RESEND_API_KEY" in worker_js and "SUBSCRIBE_FROM" in worker_js, "signup mail should name its env vars")
check("run_worker_first" in wrangler and '"main": "worker.js"' in wrangler, "api subscribe should be served by the worker")
html_pages = [
    path
    for path in ROOT.rglob("*.html")
    if ".wrangler" not in path.parts and "includes" not in path.parts
]
check(html_pages, "no html pages to check for shared chrome")
for page in html_pages:
    text = page.read_text(encoding="utf-8")
    rel = page.relative_to(ROOT).as_posix()
    check('id="site-header"' in text, f"{rel} does not mount the shared header")
    check('id="site-footer"' in text, f"{rel} does not mount the shared footer")
    check('src="/header.js"' in text and 'src="/footer.js"' in text, f"{rel} does not load the shared header and footer scripts")
    check("<header class=\"site-header\">" not in text, f"{rel} still inlines the header")
    check("footer-mark" not in text, f"{rel} still inlines the footer")

blob = "\n".join([home, directory, site_js, styles, (ROOT / "map" / "index.html").read_text(encoding="utf-8")])
for banned in ("maps.googleapis", "places.googleapis", "airtable.com", "maps.google.com"):
    check(banned not in blob, f"found banned dependency {banned}")

if failures:
    print("\n".join(failures))
    raise SystemExit(1)
print(f"site check ok ({len(restaurants)} restaurants, {len(areas)} towns)")
