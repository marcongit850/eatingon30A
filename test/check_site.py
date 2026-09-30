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
check(len(source) == 135, f"full CSV should stay at 135 published rows, got {len(source)}")
check(len(restaurants) == len(shown) == 135, "public json should include every published restaurant")
detail_pages = list((ROOT / "restaurants").glob("*/index.html"))
check(len(detail_pages) == len(restaurants), f"generated {len(detail_pages)} detail pages for {len(restaurants)} rows")
check("not on the site yet" not in home and "Design preview" not in home, "homepage should not say the catalog is still a sample")
check("full restaurant CSV" not in home.lower(), "homepage should not say the CSV is withheld")
check("<h1>Where to eat<br> on 30A.</h1>" in home, "homepage headline should say where to eat on 30A")
check('<h1 id="listing-title">Where to eat</h1>' in directory, "directory heading should be Where to eat")
check("Filter by beach town, meal, or a few words." in directory, "directory intro should name the filters")
check(
    'name="laurensFavorite"' in directory and ">Lauren’s Favorites</span>" in directory,
    "directory should offer a Lauren’s Favorites checkbox",
)
map_page = (ROOT / "map" / "index.html").read_text(encoding="utf-8")
check(
    'name="laurensFavorite"' in map_page and ">Lauren’s Favorites</span>" in map_page,
    "map should offer a Lauren’s Favorites checkbox",
)
favorite_slugs = {
    "fish-out-of-water-watercolor",
    "raw-and-juicy-alys-beach",
    "pescado-seafood-grill-and-rooftop-bar-rosemary-beach",
    "mimmos-30a-blue-mountain-beach",
    "old-florida-fish-house-seagrove-beach",
    "surfing-deer-seagrove-beach",
}
tagged = {item["slug"] for item in restaurants if item.get("laurensFavorite")}
check(tagged == favorite_slugs, f"Lauren’s Favorites should be the six named restaurants, got {sorted(tagged)}")
favorite_cards = set(re.findall(r'id="r-([^"]+)"[^>]*data-laurens-favorite="yes"', directory))
check(favorite_cards == favorite_slugs, f"directory cards tagged Lauren’s Favorites: {sorted(favorite_cards)}")
check("The table" not in directory and "Narrow the guide" not in directory, "directory should drop the old heading and intro")
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
    claim_href = build.e(build.claim_listing_href(restaurant["name"]))
    check(
        'class="listing-claim"' in page and f'href="{claim_href}"' in page and ">Claim or correct this listing</a>" in page,
        f"detail page missing claim link {restaurant['slug']}",
    )
    claim_bit = page.split('class="listing-claim"', 1)[1].split("</p>", 1)[0]
    check("—" not in claim_bit and "–" not in claim_bit, f"claim link copy uses a dash {restaurant['slug']}")
    check("maps.googleapis" not in page and "airtable" not in page.lower(), f"detail page calls a paid API {restaurant['slug']}")

check(f"Sitemap: {build.ORIGIN}/sitemap.xml" in robots, "robots missing sitemap")
check("User-agent: *" in robots and "Allow: /" in robots, "robots should allow crawlers")
missing_coords = [item["slug"] for item in restaurants if not isinstance(item.get("lat"), (int, float)) or not isinstance(item.get("lng"), (int, float)) or not item.get("address")]
check(not missing_coords, f"listings missing address or coordinates: {missing_coords}")
photos = [item for item in restaurants if item.get("image")]
missing_photos = [item["slug"] for item in restaurants if not item.get("image")]
expected_monograms = [
    "3-sons-bar-b-q-dune-allen-beach",
    "boggy-boys-pizza-seagrove-beach",
    "boxcar-annie-blue-mountain-beach",
    "dawsons-yogurt-and-fudge-seaside",
    "dough-sea-dough-seagrove-beach",
    "drome-seaside",
    "grace-pizza-and-shakes-grayton-beach",
    "hibiscus-cafe-grayton-beach",
    "nigels-bananas-seaside",
    "pecan-jacks-seagrove-beach",
    "pickles-sandbar-seaside",
    "pizza-by-the-sea-seacrest",
]
check(sorted(missing_photos) == expected_monograms, f"listings without a photo should keep a monogram, got {missing_photos}")
check(len(photos) == 123, f"expected 123 restaurant photos, got {len(photos)}")
check(build.local_listing_photo("not-a-restaurant") is None, "a slug without a dropped file should stay a monogram")
check(
    build.listing_photos("beach-happy-cafe-seagrove-beach")
    == [
        "/images/restaurants/beach-happy-cafe-seagrove-beach/01.jpg",
        "/images/restaurants/beach-happy-cafe-seagrove-beach/02.jpg",
        "/images/restaurants/beach-happy-cafe-seagrove-beach/03.jpg",
    ],
    "Beach Happy Seagrove should use the supplied frames",
)
check(
    build.listing_photos("steamboat-grill-30a-seagrove-beach")
    == [
        "/images/restaurants/steamboat-grill-30a-seagrove-beach/01.jpg",
        "/images/restaurants/steamboat-grill-30a-seagrove-beach/02.webp",
        "/images/restaurants/steamboat-grill-30a-seagrove-beach/03.jpg",
    ],
    "Steamboat should use the supplied frames",
)
oku_photo = build.listing_photos("o-ku-alys-beach")
check(oku_photo and oku_photo[0].endswith("/o-ku-alys-beach/01.jpg"), f"O-Ku cover should be 01, got {oku_photo}")
by_slug_early = {item["slug"]: item for item in restaurants}
for left, right in (
    ("amavida-coffee-roasters-seaside", "amavida-coffee-roasters-rosemary-beach"),
    ("canopy-road-cafe-inlet-beach", "canopy-road-cafe-seagrove-beach"),
    ("pizza-by-the-sea-watercolor", "pizza-by-the-sea-gulf-place"),
    ("the-perfect-pig-seagrove-beach", "the-perfect-pig-gulf-place"),
    ("the-perfect-pig-watercolor", "the-perfect-pig-seagrove-beach"),
    ("the-perfect-pig-watercolor", "the-perfect-pig-gulf-place"),
    ("black-bear-bread-co-grayton-beach", "black-bear-bread-co-seaside"),
    ("bud-and-alleys-pizza-bar-seaside", "bud-and-alleys-seaside"),
    ("cowgirl-kitchen-blue-mountain-beach", "cowgirl-kitchen-rosemary-beach"),
    ("goatfeathers-seafood-market-inlet-beach", "goatfeathers-seafood-market-east-location-seagrove-beach"),
    ("beach-happy-cafe-seagrove-beach", "beach-happy-cafe-watercolor"),
):
    check(by_slug_early[left]["image"] and by_slug_early[left]["image"] != by_slug_early[right]["image"], f"{left} and {right} should use different photos")
for item in photos:
    path = ROOT / item["image"].lstrip("/")
    check(path.is_file(), f"missing photo file {item['image']}")
    check(item["image"].endswith("/01.jpg"), f"cover should be 01.jpg for {item['slug']}")
    check(path.stat().st_size < 500_000, f"photo too large for the web: {item['image']}")
readme = (ROOT / "README.md").read_text(encoding="utf-8")
check("images/restaurants/" in readme and "`01` is the cover" in readme, "README should say how restaurant photos are stored")
check("does not call Google Places" in readme, "README should keep Google Places off")
check("popup-address" in site_js and "markerPopup" in site_js, "map popups should include the street address")
check('>View restaurant</a>' in site_js and "View profile" not in site_js, "map popup CTA should say View restaurant")
check('emptyLabel = "Where to eat"' in site_js, "unfiltered directory title should be Where to eat")
pin_rule = styles.split(".leaflet-marker-icon.pin", 1)
check(len(pin_rule) == 2 and "background:" in pin_rule[1][:400], "map pins must paint a fill on Leaflet's marker class")
check(".leaflet-div-icon.pin" not in styles, "pin styles must not depend on the class Leaflet drops")
about = (ROOT / "about" / "index.html").read_text(encoding="utf-8")
for banned in ("CSV files", "Google Places", "OpenStreetMap tiles", "monogram in a set frame"):
    check(banned not in about, f"about page still mentions {banned}")
check("editorial" not in about.lower(), "about should not call the site an editorial guide")
check("CSV" not in about and "OpenStreetMap" not in about and "Google Places" not in about, "about should stay free of build talk")
check(f"<p>{build.ABOUT_LEAD}</p><p>{build.ABOUT_TOWNS}</p>" in about, "about page should use the two visitor paragraphs")
check("a feel for the place" not in about.split("<main", 1)[-1].split("</main>", 1)[0], "about body should use the new guide copy")
contact = (ROOT / "contact" / "index.html").read_text(encoding="utf-8")
for banned in ("github.com", "GitHub", "restaurants.csv", "locations.csv", "README", "CSV", "Wix", "custom domain"):
    check(banned not in contact, f"contact page still mentions {banned}")
check("Corrections and new listings" in contact, "contact page should keep the corrections heading")
check(
    "Restaurant hours, phone numbers, websites, and other details are listed on each restaurant page." in contact
    and "If something needs to be updated, a restaurant has closed, or we’re missing a place you think should be included, let us know." in contact,
    "contact page should use Marc's first intro paragraph",
)
check(
    "Just include the restaurant name and what needs to be changed or added. We review every submission and can follow up using the email address you provide." in contact,
    "contact page should use Marc's second intro paragraph",
)
check("listing-hint" not in contact and "Update covers hours" not in contact, "contact page should not explain the request types")
check("We read these" not in contact, "contact page should drop the previous intro")
check("Marc" not in contact, "contact page should not name a person")
check(">Submit</button>" in contact, "contact submit button should say Submit")
check("Send to Marc" not in contact and "Town / location" not in contact, "contact form should drop the personal send label and the town field")
check('action="/api/listing"' in contact and 'data-listing' in contact, "contact form should post to the listing endpoint")
check('name="restaurant"' in contact and 'name="details"' in contact, "contact form is missing restaurant fields")
check('name="town"' not in contact, "contact form should not ask for a town")
check('name="name"' in contact and 'name="email"' in contact, "contact form should ask for a reply name and email")
contact_form = contact.split("<form", 1)[1].split("</form>", 1)[0]
contact_fields = ["name", "email", "restaurant", "type", "details"]
contact_order = [contact_form.find(f'name="{field}"') for field in contact_fields]
check(all(index >= 0 for index in contact_order) and contact_order == sorted(contact_order), "contact fields should run name, email, restaurant, type, details")
for request_type in ("update", "edit", "deletion", "new", "other"):
    check(f'value="{request_type}"' in contact, f"contact form missing request type {request_type}")
check(
    '<label class="listing-choice"><input type="radio" name="type" value="other"> <span>Other</span></label>' in contact,
    "contact form should offer Other in the same radio style as the other request types",
)
check(
    '<label><span>Restaurant name</span><input name="restaurant" type="text" maxlength="160" autocomplete="organization"></label>' in contact,
    "restaurant name should stay on the form without a required mark",
)
check("Restaurant name <abbr" not in contact, "restaurant name should not show a required asterisk")
check('src="/listing.js"' in contact, "contact page should load the listing form script")
listing_js = (ROOT / "listing.js").read_text(encoding="utf-8")
check('params.get("restaurant")' in listing_js and 'params.get("subject")' in listing_js, "listing form should read restaurant and subject query params")
check('[name="restaurant"]' in listing_js and '[name="details"]' in listing_js, "listing form should prefill the restaurant and details fields")
listing_js = (ROOT / "listing.js").read_text(encoding="utf-8")
check("/api/listing" in listing_js, "listing script should post to the worker")
check("town" not in listing_js, "listing script should not send a town")
check("Enter the restaurant name." not in listing_js, "listing script should allow a blank restaurant name")
check('body.type !== "other"' in listing_js, "listing script should accept an Other request")
check("Marc" not in listing_js and "Thanks. We have your note." in listing_js, "listing script should thank without a personal name")
check(".listing-form" in styles and ".listing-status" in styles, "listing form should use the site styles")
check("See the restaurants" in about and "Open the directory" not in about, "about button should invite visitors in")
check("<h2 id=\"print-guides-heading\">Coming in 2027</h2>" in about, "about page should announce printed guides coming in 2027")
check(f"<p>{build.e(build.PRINT_GUIDES)}</p>" in about, "about page should use the print-guide paragraph")
print_section = about.split('class="print-guides"', 1)[1].split("</section>", 1)[0]
guide_at = print_section.find(build.e(build.PRINT_GUIDES))
contact_at = print_section.find('For information or to reserve your space, please <a class="text-link" href="/contact/">contact us</a>.')
covers_at = print_section.find('class="print-covers"')
check(
    0 <= guide_at < contact_at < covers_at,
    "print inquiries should link to contact between the paragraph and the covers",
)
check("—" not in about and "–" not in about, "about page should not use em or en dashes")
check('class="print-covers"' in about, "about page should show the print covers together")
for path, alt in build.PRINT_COVERS:
    check(f'src="{path}.jpg"' in about and f'srcset="{path}.webp"' in about, f"about page should include {path}")
    check(f'alt="{build.e(alt)}"' in about, f"about page should describe {path}")
    for ext in (".jpg", ".webp"):
        cover = ROOT / path.lstrip("/")
        cover = cover.with_suffix(ext)
        check(cover.is_file(), f"missing print cover {cover.name}")
        check(cover.stat().st_size < 400_000, f"print cover too large for the web: {cover.name}")
check(".print-covers" in styles and "grid-template-columns: 1fr" in styles, "print covers should stack in one column")
check(
    "grid-template-columns: repeat(2, minmax(0, 1fr))" in styles,
    "print covers should sit side by side on wider screens",
)
check("Find breakfast, lunch, and dinner along Scenic Highway 30A" in home, "homepage hero should welcome visitors to 30A")
check('src="/images/hero-beachside-dining.jpg"' in home, "homepage hero should use the beachside dining photo")
check('srcset="/images/hero-beachside-dining.webp"' in home, "homepage hero should offer the WebP photo")
check(
    "A beachside table set with oysters, fish tacos, brunch, a cocktail, and coffee, with the Gulf in the background." in home,
    "homepage hero alt should describe beachside dining",
)
check("de29ed_1473adbe1b4b4c068a746d2bd7c0fc46" not in home, "homepage should drop the old Wix hero")
check(
    'property="og:image" content="https://eatingon30a.352marc.workers.dev/images/hero-beachside-dining.jpg"' in home,
    "homepage share image should be the beachside dining photo",
)
for hero_name in ("images/hero-beachside-dining.jpg", "images/hero-beachside-dining.webp"):
    hero_path = ROOT / hero_name
    check(hero_path.is_file(), f"missing hero photo {hero_name}")
    check(hero_path.stat().st_size < 400_000, f"hero photo too large for the web: {hero_name}")
check("editorial" not in home.lower() and "already filtered" not in home, "homepage should not sound like a product or an editorial")
check("a feel for the place" in home, "homepage essay should use the visitor guide")
areas_index = (ROOT / "areas" / "index.html").read_text(encoding="utf-8")
check("<h1>Beach Towns of 30A</h1>" in areas_index, "towns page heading should name the beach towns")
check(
    "From Dune Allen to Inlet Beach, explore the communities of 30A and find restaurants in each one." in areas_index,
    "towns page intro should invite visitors to the communities",
)
town_count = styles.split(".town small {", 1)
check(
    len(town_count) == 2 and "white-space: nowrap" in town_count[1][:500],
    "town restaurant counts should stay on one line",
)
check("8 Restaurants" in areas_index and "8 places" not in areas_index, "town cards should count Restaurants")
check("8 Restaurants" in home and re.search(r"\bplaces\b", home) is None, "homepage town counts should say Restaurants")
check(build.restaurant_count_word(1, label=True) == "Restaurant", "a single listing is a Restaurant label")
check(build.restaurant_count_word(7) == "restaurants", "sentence counts stay lowercase")
check("1 restaurant on the map" in site_js and "restaurants on the map" in site_js, "map count should say restaurants")
check("place on the map" not in site_js, "map count should not say place")
check("filter" not in areas_index.lower() and "directory" not in areas_index.lower(), "towns page should not explain the directory")
dune = (ROOT / "areas" / "dune-allen-beach" / "index.html").read_text(encoding="utf-8")
check("Show 5 Restaurants" in dune, "Dune Allen should label its count as Restaurants")
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
    "fish-out-of-water-watercolor",
    "cafe-thirty-a-seagrove-beach",
    "shades-bar-and-grill-inlet-beach",
], "featured cover should be Fish Out of Water, Café Thirty-A, then Shades")
check(len(set(by_slug[slug]["areaSlug"] for slug in featured)) == len(featured), "featured listings should use different towns")
check({"$$", "$$$"} <= {by_slug[slug]["price"] for slug in featured}, "featured mix should include casual and upscale")
check(home.count('<div class="cover" data-featured') == len(featured), "homepage should render every featured cover")
check("86400000" in home and "from-the-guide" in home, "homepage should rotate the cover by UTC day")
check(home.count('class="kicker">Featured') == len(featured), "each featured cover uses the Featured kicker")
check("From the guide" not in home, "homepage should not keep the old featured heading")
check('aria-label="Previous featured"' in home and 'aria-label="Next featured"' in home, "featured arrows need accessible names")
check('data-featured-step="-1"' in home and 'data-featured-step="1"' in home, "featured arrows should step through the list")
check('class="cover-controls" hidden' in home, "featured arrows stay hidden until the page script runs")
check("stepFeatured" in site_js and "data-featured-step" in site_js, "page script should cycle the featured cover")
check("featuredAutoRotate" in site_js and "FEATURED_ROTATE_MS = 8000" in site_js, "featured cover should auto-rotate every 8 seconds")
check("mouseenter" in site_js and "focusin" in site_js, "featured auto-rotate should pause for pointer and focus")
check("visibilitychange" in site_js and "pagehide" in site_js, "featured auto-rotate should clear its timer when the page is hidden")
check("prefers-reduced-motion: reduce" in site_js, "featured auto-rotate should respect reduced motion")
check("mapListCard" in site_js and "map-thumb" in site_js and "openPopup" in site_js, "map list should use compact cards and still open the pin")
check("#map-list .map-hit" in styles and "#map-list .map-thumb" in styles, "map list cards should stay compact")
check(".cover-arrow" in styles and "min-width: 44px" in styles, "featured arrows should stay large enough to tap")
for slug in featured:
    check(f'/restaurants/{slug}/' in home, f"homepage cover missing {slug}")
    check(f'href="/restaurants/{slug}/">View restaurant</a>' in home, f"featured cover for {slug} should say View restaurant")
check("Read the profile" not in home, "featured cover should not put the profile URL in the label")
check("View restaurant" in home, "featured cover CTA should say View restaurant")
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
check("/images/restaurants/stinkys-fish-camp-dune-allen-beach/01.jpg" in stinkys, "Stinky's should use the supplied cover")
check("/images/restaurants/stinkys-fish-camp-logo.jpg" in stinkys, "Stinky's logo should be a local file")
check("static.wixstatic.com" not in stinkys, "Stinky's profile should not hotlink Wix for its photos")
oku = (ROOT / "restaurants" / "o-ku-alys-beach" / "index.html").read_text(encoding="utf-8")
oku_hero = oku.split('class="profile-hero"', 1)[1].split('class="profile-film"', 1)[0]
check("/images/restaurants/o-ku-alys-beach/01.jpg" in oku_hero, "O-Ku hero should be the supplied cover")
check('class="profile-film"' in oku and "/images/restaurants/o-ku-alys-beach/02.jpg" in oku, "O-Ku profile should show the extra photos")
steam = (ROOT / "restaurants" / "steamboat-grill-30a-seagrove-beach" / "index.html").read_text(encoding="utf-8")
steam_hero = steam.split('class="profile-hero"', 1)[1].split('class="profile-film"', 1)[0]
check("/images/restaurants/steamboat-grill-30a-seagrove-beach/01.jpg" in steam_hero, "Steamboat hero should be the supplied cover")
check(
    'class="profile-film"' in steam
    and "/images/restaurants/steamboat-grill-30a-seagrove-beach/02.webp" in steam
    and "/images/restaurants/steamboat-grill-30a-seagrove-beach/03.jpg" in steam,
    "Steamboat profile should show the extra photos",
)
happy = (ROOT / "restaurants" / "beach-happy-cafe-seagrove-beach" / "index.html").read_text(encoding="utf-8")
happy_hero = happy.split('class="profile-hero"', 1)[1].split('class="profile-film"', 1)[0]
check("/images/restaurants/beach-happy-cafe-seagrove-beach/01.jpg" in happy_hero, "Beach Happy Seagrove hero should be the supplied cover")
check(
    "/images/restaurants/beach-happy-cafe-seagrove-beach/02.jpg" in happy
    and "/images/restaurants/beach-happy-cafe-seagrove-beach/03.jpg" in happy,
    "Beach Happy Seagrove profile should show the extra photos",
)
plain = (ROOT / "restaurants" / "nigels-bananas-seaside" / "index.html").read_text(encoding="utf-8")
plain_hero = plain.split('class="profile-hero"', 1)[1].split('class="wrap profile-head"', 1)[0]
check('class="ph"' in plain_hero and 'class="mono"' in plain_hero, "a listing without a photo should keep the monogram")
check("<img" not in plain_hero and 'class="profile-film"' not in plain, "Nigel's should stay a monogram")
check("Black%20Heart" not in directory and "/images/restaurants/stinkys-fish-camp-dune-allen-beach/01.jpg" in stinkys, "heart placeholder should not be the photo")
check("static.wixstatic.com" in home, "town photos should use the working Wix image URLs")
for town_slug, town_alt in (
    ("watersound", "Watersound on Scenic Highway 30A"),
    ("watersound-origins", "Watersound Origins on Scenic Highway 30A"),
):
    town_src = f"/images/areas/{town_slug}.jpg"
    town_file = ROOT / town_src.lstrip("/")
    check(town_file.is_file(), f"missing town photo {town_src}")
    check(town_file.stat().st_size < 400_000, f"town photo too large for the web: {town_src}")
    check(f'src="{town_src}"' in home and town_alt in home, f"homepage should show the {town_slug} photo")
    check(f'src="{town_src}"' in areas_index, f"towns page should show the {town_slug} photo")
    town_page = (ROOT / "areas" / town_slug / "index.html").read_text(encoding="utf-8")
    check(f'src="{town_src}"' in town_page, f"{town_slug} page should use its town photo")
    card = home.split(f'href="/restaurants/?area={town_slug}"', 1)[1].split("</a>", 1)[0]
    check('class="ph"' not in card, f"{town_slug} homepage card should not keep the placeholder")

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
check("Be sure to also check out" in shared_footer, "footer should point visitors to the sister guide")
check(
    'class="footer-also"' in shared_footer and 'href="https://eatingindestin.352marc.workers.dev"' in shared_footer,
    "footer promo should link Eating in Destin",
)
check(
    'src="/images/eating-in-destin-logo.png"' in shared_footer and 'alt="Eating in Destin"' in shared_footer,
    "footer promo should use the Destin logo with alt text",
)
check((ROOT / "images" / "eating-in-destin-logo.png").is_file(), "Destin logo should be a local file")
check("a.footer-also" in styles and "width: 8.5rem" in styles, "Destin promo should stay a small footer line")
check("logo.svg" not in shared_header and "logo.svg" not in shared_footer and not (ROOT / "logo.svg").exists(), "the masthead file should stay out of the site")
check((ROOT / "images" / "eating-on-30a-logo.png").is_file(), "transparent logo file should be in images")
check('href="/favicon.png"' in home and 'href="/apple-touch-icon.png"' in home, "home should link the circle favicon")
check('href="/favicon.svg"' not in home, "home should not keep the old svg favicon")
check((ROOT / "favicon.png").is_file() and (ROOT / "favicon.ico").is_file(), "favicon png and ico should exist")
check((ROOT / "apple-touch-icon.png").is_file() and (ROOT / "images" / "eating-favicon-512.png").is_file(), "apple touch and 512 favicon should exist")
check(not (ROOT / "favicon.svg").exists(), "old svg favicon should be removed")
check("brand-logo" not in styles and "subscribe-band" in styles and "subscribe-popup" in styles, "subscribe styles should stay in place")
check("Yes, I want coupons!" in shared_footer and 'name="email"' in shared_footer, "footer subscribe is missing the coupon fields")
check(">Local<" in shared_footer and ">Visitor<" in shared_footer, "footer subscribe should offer Local and Visitor")
check('id="subscribe-popup"' in shared_footer and "Exclusive restaurant coupons" in shared_footer, "coupon popup and footer headline")
subscribe_js = (ROOT / "subscribe.js").read_text(encoding="utf-8")
check("30000" in subscribe_js and "localStorage" in subscribe_js, "popup should wait 30s and remember dismiss in localStorage")
worker_js = (ROOT / "worker.js").read_text(encoding="utf-8")
check("CONTACT_EMAIL" in worker_js and "RESEND_API_KEY" in worker_js and "SUBSCRIBE_FROM" in worker_js, "signup mail should name its env vars")
check('pathname === "/api/listing"' in worker_js and "reply_to" in worker_js, "listing mail should use the same Resend secrets and a reply address")
check('other: "Other"' in worker_js, "worker should accept an Other listing request")
check("Enter the restaurant name." not in worker_js, "worker should not require a restaurant name")
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
