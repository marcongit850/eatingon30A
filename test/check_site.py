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
check(len(source) == 155, f"full CSV should stay at 155 published rows, got {len(source)}")
check(len(restaurants) == len(shown) == 155, "public json should include every published restaurant")
detail_pages = list((ROOT / "restaurants").glob("*/index.html"))
check(len(detail_pages) == len(restaurants), f"generated {len(detail_pages)} detail pages for {len(restaurants)} rows")
check("not on the site yet" not in home and "Design preview" not in home, "homepage should not say the catalog is still a sample")
check("full restaurant CSV" not in home.lower(), "homepage should not say the CSV is withheld")
check("<h1>Where to eat<br> on 30A.</h1>" in home, "homepage headline should say where to eat on 30A")
check('<h1 id="listing-title">Restaurants on 30A</h1>' in directory, "directory heading should name restaurants on 30A")
check("Filter by beach town, meal, or a few words." in directory, "directory intro should name the filters")
tour_at = directory.find('class="video-tour"')
tour = directory[tour_at:].split("</figure>", 1)[0] if tour_at >= 0 else ""
check(tour_at > 0 and tour_at < directory.find('id="listing-title"'), "directory should place the video tour with the intro")
check('aria-label="Video tour"' in tour, "video tour should have a short accessible name")
check("Play video tour" in tour and "Stop video tour" in tour, "video tour button should offer play and stop")
check('type="button"' in tour and "video-tour-control" in tour, "video tour control should be a button")
check('src="/videos/eating-on-30a-tour.mp4"' in tour, "video tour should use the committed clip")
check('src="/images/eating-on-30a-tour-poster.jpg"' in tour, "video tour should use the committed poster")
check("autoplay" not in tour and "loop" not in tour, "video tour should not autoplay or loop")
check("—" not in tour and "–" not in tour, "video tour copy should not use em or en dashes")
check((ROOT / "videos" / "eating-on-30a-tour.mp4").is_file(), "tour video file should be in the repo")
check((ROOT / "images" / "eating-on-30a-tour-poster.jpg").is_file(), "tour poster file should be in the repo")
check('class="video-tour"' not in home, "homepage should not include the video tour")
check('aria-label="Town guides"' not in directory, "town pages should not sit in a row above the filters")
check('<select id="area"' in directory and ">All towns</option>" in directory, "directory should keep the town dropdown")
switch_at = directory.find('class="view-switch"')
filters_at = directory.find('id="filters"')
cards_at = directory.find('id="cards"')
browse_at = directory.find('id="browse-areas"')
check(
    0 < switch_at < filters_at < cards_at < browse_at,
    "directory should show List/Map, then filters, then listings, then browse by area",
)
check('aria-current="page">List</a>' in directory and 'data-view-href="/map/"' in directory, "directory should offer a Map view beside the filters")
check("<h2 id=\"browse-areas-title\">Browse by area</h2>" in directory, "directory should title the town links Browse by area")
map_page = (ROOT / "map" / "index.html").read_text(encoding="utf-8")
map_switch = map_page.find('class="view-switch"')
map_filters = map_page.find('id="filters"')
check(0 < map_switch < map_filters, "map should offer List/Map above the filters")
check('aria-current="page">Map</a>' in map_page and 'data-view-href="/restaurants/"' in map_page, "map should link back to the listing")
check('id="browse-areas"' not in map_page, "browse by area belongs under the directory listings")
check('class="video-tour"' not in map_page, "map should not include the video tour")
coast_at = map_page.find('class="coast-360"')
coast = map_page[coast_at:].split("</a>", 1)[0] if coast_at >= 0 else ""
check(0 < coast_at < map_page.find('id="listing-title"'), "map should place the 360 thumbnail with the intro")
check(coast_at < map_filters, "360 thumbnail should stay above the filters")
check('href="https://www.youtube.com/watch?v=55EsjB_V_L8&amp;t=2720s"' in coast, "360 thumbnail should link to the 30A film")
check('target="_blank"' in coast and 'rel="noopener"' in coast, "360 film should open in a new tab")
check(">Click to see 30A in 360 degrees.</span>" in coast, "360 thumbnail should use the short caption")
check('src="/images/30a-360.webp"' in coast, "360 thumbnail should use the committed image")
check("—" not in coast and "–" not in coast, "360 caption should not use em or en dashes")
coast_image = ROOT / "images" / "30a-360.webp"
check(coast_image.is_file() and coast_image.stat().st_size < 120_000, "360 thumbnail should be a small web image")
check('class="coast-360"' not in directory, "restaurants index should keep its own tour, not the 360 thumbnail")
check('class="coast-360"' not in home, "homepage should not include the 360 thumbnail")
detail_with_tour = [
    page.parent.name
    for page in detail_pages
    if 'class="video-tour"' in page.read_text(encoding="utf-8")
]
check(not detail_with_tour, "video tour should stay off restaurant detail pages")
check(
    'name="laurensFavorite"' in directory and ">Lauren’s Favorites</span>" in directory,
    "directory should offer a Lauren’s Favorites checkbox",
)
check(
    'name="laurensFavorite"' in map_page and ">Lauren’s Favorites</span>" in map_page,
    "map should offer a Lauren’s Favorites checkbox",
)
for name, label in (
    ("reservations", "Takes reservations"),
    ("groups", "Good for groups 12+"),
    ("happyfood", "Happy hour food"),
    ("happydrinks", "Happy hour drinks"),
):
    check(
        f'name="{name}"' in directory and f">{label}</span>" in directory,
        f"directory should offer a {label} checkbox",
    )
    check(
        f'name="{name}"' in map_page and f">{label}</span>" in map_page,
        f"map should offer a {label} checkbox",
    )
check('class="amenities"' not in directory, "directory should keep amenities in the existing chips")
fish_page = (ROOT / "restaurants" / "fish-out-of-water-watercolor" / "index.html").read_text(encoding="utf-8")
check("<ul class=\"chips\">" in fish_page and "Good for groups 12+" in fish_page, "Fish Out of Water should chip verified group dining")
check("Takes reservations" not in fish_page, "Fish Out of Water should not claim reservations")
check("class=\"amenities\"" not in fish_page, "listing amenities should stay in the existing chips")
daytrader_page = (ROOT / "restaurants" / "the-daytrader-tiki-bar-and-restaurant-seaside" / "index.html").read_text(encoding="utf-8")
check("Takes reservations" not in daytrader_page, "Daytrader should not claim reservations")
check('class="listing-claim"' in fish_page, "Fish Out of Water should keep the claim link")
fish = next(item for item in restaurants if item["slug"] == "fish-out-of-water-watercolor")
check(fish.get("music") is True, "Fish Out of Water should keep live music as yes")
music_note = "Live music is seasonal and subject to change — confirm with the restaurant."
for item in restaurants:
    page = (ROOT / "restaurants" / item["slug"] / "index.html").read_text(encoding="utf-8")
    if item.get("music"):
        check(
            ">Live music*</li>" in page and music_note in page,
            f"{item['slug']} should mark the live music chip as seasonal",
        )
    else:
        check(
            "Live music*" not in page and music_note not in page,
            f"{item['slug']} should not show a live music chip or seasonal note",
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
browse = directory.split('id="browse-areas"', 1)[1]
for area in areas:
    check(f'href="/areas/{area["slug"]}/"' in home, f"homepage missing area page {area['slug']}")
    check((ROOT / "areas" / area["slug"] / "index.html").exists(), f"missing town page {area['slug']}")
    town_href = f'href="/areas/{area["slug"]}/"'
    check(browse.count(town_href) == 1, f"browse by area should link to {area['slug']}")
    check(directory.count(town_href) == 1, f"town page link for {area['slug']} should only be in browse by area")

full_by_slug = {item["slug"]: item for item in shown}
guide_specs = build.guide_picks(shown, build.load_areas(shown))
for restaurant in restaurants:
    path = ROOT / "restaurants" / restaurant["slug"] / "index.html"
    check(path.exists(), f"missing detail page {restaurant['slug']}")
    check(f"/restaurants/{restaurant['slug']}/" in directory, f"directory missing {restaurant['slug']}")
    check(f"{build.ORIGIN}/restaurants/{restaurant['slug']}/" in sitemap, f"sitemap missing {restaurant['slug']}")
    page = path.read_text(encoding="utf-8")
    full = full_by_slug[restaurant["slug"]]
    check(f"<h1>{build.e(restaurant['name'])}</h1>" in page, f"detail h1 should be the name only {restaurant['slug']}")
    check('class="place"' not in page and "Other locations" not in page, f"detail page picked up listing chrome {restaurant['slug']}")
    check('aria-label="Related guides"' not in page, f"detail page should not add a guides nav {restaurant['slug']}")
    story = page.split('class="prose profile-story"', 1)[1].split("</div>", 1)[0]
    visible_story = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", story)).strip()
    # Inline note links leave a space where the tag was, so "menu," becomes "menu ,".
    def story_text(value: str) -> str:
        return re.sub(r"\s+([,.;:!?])", r"\1", value)
    check(story_text(build.e(full["notes"])) in story_text(visible_story), f"detail notes missing {restaurant['slug']}")
    if full.get("noteParagraphs", 0) > 1:
        check(
            story.count("<p>") == full["noteParagraphs"],
            f"multi-paragraph notes should be the description {restaurant['slug']}",
        )
        check(
            build.e(build.listing_intro(full)) not in story,
            f"owner description should replace the generated intro {restaurant['slug']}",
        )
    check("Scenic Highway 30A" in page, f"detail intro missing 30A {restaurant['slug']}")
    check(f'href="/areas/{restaurant["areaSlug"]}/"' in page, f"detail missing area link {restaurant['slug']}")
    schema_match = re.search(r'<script type="application/ld\+json">(.*?)</script>', page)
    check(schema_match is not None, f"detail missing json-ld {restaurant['slug']}")
    if schema_match:
        schema = json.loads(schema_match.group(1))
        nodes = schema.get("@graph") or []
        place = next(
            (
                node
                for node in nodes
                if node.get("@type") == "Restaurant"
                or (isinstance(node.get("@type"), list) and "Restaurant" in node["@type"])
            ),
            None,
        )
        check(place is not None, f"detail schema missing Restaurant {restaurant['slug']}")
        if place:
            check(place.get("name") == restaurant["name"], f"schema name {restaurant['slug']}")
            check(str(place.get("url", "")).startswith(f"{build.ORIGIN}/restaurants/"), f"schema url {restaurant['slug']}")
            check(place.get("address", {}).get("addressCountry") == "US", f"schema address {restaurant['slug']}")
            check("aggregateRating" not in place and "review" not in place, f"schema invented a rating {restaurant['slug']}")
            check("openingHours" not in place and "openingHoursSpecification" not in place, f"schema invented hours {restaurant['slug']}")
            if restaurant.get("phone"):
                check(place.get("telephone") == restaurant["phone"], f"schema phone {restaurant['slug']}")
            if restaurant.get("cuisines"):
                check(place.get("servesCuisine") == restaurant["cuisines"], f"schema cuisine {restaurant['slug']}")
            if restaurant.get("image"):
                check(str(place.get("image", "")).startswith("https://"), f"schema image {restaurant['slug']}")
    check('class="profile"' in page and 'class="profile-hero"' in page, f"detail page left the shared profile template {restaurant['slug']}")
    claim_href = build.e(build.claim_listing_href(restaurant["name"], restaurant["slug"]))
    check(
        'class="listing-claim"' in page
        and f'href="{claim_href}"' in page
        and ">Update this listing</a>" in page
        and 'href="/list-your-restaurant/">List your restaurant</a>' in page,
        f"detail page missing update and list links {restaurant['slug']}",
    )
    claim_bit = page.split('class="listing-claim"', 1)[1].split("</p>", 1)[0]
    check("—" not in claim_bit and "–" not in claim_bit, f"claim link copy uses a dash {restaurant['slug']}")
    check("maps.googleapis" not in page and "airtable" not in page.lower(), f"detail page calls a paid API {restaurant['slug']}")
    site_link = build.website_link(full["website"])
    if site_link:
        check(site_link in page, f"restaurant website should open in a new tab {restaurant['slug']}")
    check(
        page.count('target="_blank"') == build.external_link_count(full),
        f"external note links should open in a new tab {restaurant['slug']}",
    )

for spec in guide_specs:
    guide_html = (ROOT / "guides" / spec["slug"] / "index.html").read_text(encoding="utf-8")
    for item in spec["restaurants"]:
        check(
            f'/restaurants/{item["slug"]}/' in guide_html,
            f"guide {spec['slug']} should link to {item['slug']}",
        )

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
    "crust-artisan-bakery",
    "dawsons-yogurt-and-fudge-seaside",
    "dough-sea-dough-seagrove-beach",
    "drome-seaside",
    "grace-pizza-and-shakes-grayton-beach",
    "hibiscus-cafe-grayton-beach",
    "nigels-bananas-seaside",
    "pecan-jacks-seagrove-beach",
    "pizza-by-the-sea-seacrest",
]
check(sorted(missing_photos) == expected_monograms, f"listings without a photo should keep a monogram, got {missing_photos}")
check(len(photos) == 143, f"expected 143 restaurant photos, got {len(photos)}")
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
seagrove_cover = build.local_image_info(ROOT / "images/restaurants/beach-happy-cafe-seagrove-beach/01.jpg")
check(
    seagrove_cover
    and seagrove_cover[0] > seagrove_cover[1]
    and seagrove_cover[0] / seagrove_cover[1] >= 1.4,
    f"Beach Happy Seagrove cover should be a landscape hero, got {seagrove_cover}",
)
seagrove_coffee = build.local_image_info(ROOT / "images/restaurants/beach-happy-cafe-seagrove-beach/02.jpg")
check(
    seagrove_coffee and seagrove_coffee[0] > seagrove_coffee[1],
    f"Beach Happy Seagrove iced coffee should be a landscape film crop, got {seagrove_coffee}",
)
seagrove_drink = build.local_image_info(ROOT / "images/restaurants/beach-happy-cafe-seagrove-beach/03.jpg")
check(
    seagrove_drink == (1067, 1600, "image/jpeg"),
    f"Beach Happy Seagrove cocktail frame should stay the original portrait, got {seagrove_drink}",
)
check(
    build.listing_photos("beach-happy-cafe-watercolor")
    == [f"/images/restaurants/beach-happy-cafe-watercolor/0{n}.jpg" for n in range(1, 7)],
    "Beach Happy WaterColor should use six frames",
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
check('emptyLabel = "Restaurants on 30A"' in site_js, "unfiltered directory title should name restaurants on 30A")
pin_rule = styles.split(".leaflet-marker-icon.pin", 1)
check(len(pin_rule) == 2 and "background:" in pin_rule[1][:400], "map pins must paint a fill on Leaflet's marker class")
check(".leaflet-div-icon.pin" not in styles, "pin styles must not depend on the class Leaflet drops")
about = (ROOT / "about" / "index.html").read_text(encoding="utf-8")
for banned in ("CSV files", "Google Places", "OpenStreetMap tiles", "monogram in a set frame"):
    check(banned not in about, f"about page still mentions {banned}")
check("editorial" not in about.lower(), "about should not call the site an editorial guide")
check("CSV" not in about and "OpenStreetMap" not in about and "Google Places" not in about, "about should stay free of build talk")
check(f"<p>{build.ABOUT_LEAD}</p><p>{build.ABOUT_TOWNS}</p>" in about, "about page should use the two visitor paragraphs")
story_html = "".join(f"<p>{build.e(paragraph)}</p>" for paragraph in build.ABOUT_STORY)
check(
    f"<p>{build.ABOUT_TOWNS}</p>{story_html}" in about,
    "about page should append the experience paragraphs under the visitor copy",
)
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
check('href="/list-your-restaurant/">full listing form</a>' in contact, "contact page should link to the full listing form")
check("For a new restaurant or a complete update" in contact, "contact page should point complete updates at the full form")
listing_page = (ROOT / "list-your-restaurant" / "index.html").read_text(encoding="utf-8")
check("<h1 class=\"form-title\">List or Update your restaurant</h1>" in listing_page, "listing form page should use the list heading")
check('rel="canonical" href="https://www.eatingon30a.com/list-your-restaurant/"' in listing_page, "listing form page should set a canonical URL")
check("action=\"/api/list-restaurant\"" in listing_page and "data-list-restaurant" in listing_page, "listing form should post to the full endpoint")
check('enctype="multipart/form-data"' in listing_page, "listing form should submit image files as multipart")
check('name="eo30a_hp"' in listing_page, "listing form should include a honeypot")
check(
    'name="photos" type="file"' in listing_page and "multiple" in listing_page,
    "listing form should offer one multi-image file field",
)
check(
    'accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"' in listing_page,
    "listing form should accept jpeg, png, and webp",
)
check("Drop logos or pictures here" in listing_page, "listing form should invite people to drop logos or pictures")
check('class="media-error"' in listing_page, "listing form should show an image error beside the drop box")
check(
    'name="logoUrl"' not in listing_page and 'name="listPhotoUrl"' not in listing_page and 'name="detailPhotoUrl"' not in listing_page,
    "listing form should not ask for photo URLs",
)
social_at = (
    listing_page.find('name="facebook"'),
    listing_page.find('name="instagram"'),
    listing_page.find('name="videoUrl"'),
    listing_page.find('name="photos"'),
)
check(
    all(index >= 0 for index in social_at) and social_at == tuple(sorted(social_at)) and len(set(social_at)) == 4,
    "social links and video should sit above the image drop box",
)
check(
    "Paste a link" not in listing_page and "email them after you submit" not in listing_page and "as a file" not in listing_page,
    "listing form should not add an upload or contact-form note on the media links",
)
check("Live music*" in listing_page and "Live music is seasonal and subject to change." in listing_page, "listing form should mark live music as seasonal")
check(listing_page.count('<abbr title="required">*</abbr>') == 2, "only name and email should show a required mark")
check(listing_page.count(" required") == 2, "only name and email inputs should be required")
check('name="name" type="text" required' in listing_page, "name should stay required")
check('type="email" required' in listing_page, "email should stay required")
check("Choose at least one." not in listing_page, "listing form should not require a cuisine or meal")
check("Required when you are updating" not in listing_page, "listing form should not require the current listing")
check("—" not in listing_page and "–" not in listing_page, "listing form page should not use em or en dashes")
check('src="/list-restaurant.js"' in listing_page, "listing form page should load its script")
for field in ("name", "role", "email", "contactPhone", "bestTime", "intent", "existingListing", "restaurant", "area", "address", "restaurantPhone", "website", "price", "description", "seasonalNote", "cuisines", "meals", "foods", "facebook", "instagram", "videoUrl", "photos", "notes", "authorized"):
    check(f'name="{field}"' in listing_page, f"listing form missing {field}")
for amenity in ("outdoor", "happyDrinks", "happyFood", "reservations", "kids", "groups", "music"):
    check(f'name="{amenity}"' in listing_page, f"listing form missing amenity {amenity}")
options = json.loads((ROOT / "data" / "listing-form.json").read_text(encoding="utf-8"))
for area in options["areas"]:
    check(f'<option value="{build.e(area)}">{build.e(area)}</option>' in listing_page, f"listing form missing area {area}")
for cuisine in options["cuisines"]:
    check(f'name="cuisines" value="{build.e(cuisine)}"' in listing_page, f"listing form missing cuisine {cuisine}")
for food in options["foods"]:
    check(f'name="foods" value="{build.e(food)}"' in listing_page, f"listing form missing food {food}")
for meal in ("Breakfast", "Brunch", "Lunch", "Dinner", "Late night"):
    check(f'name="meals" value="{meal}"' in listing_page, f"listing form missing meal {meal}")
list_js = (ROOT / "list-restaurant.js").read_text(encoding="utf-8")
check("/api/list-restaurant" in list_js and "eo30a_hp" in list_js, "listing form script should post the honeypot with the form")
check("FormData" in list_js and 'accept: "application/json"' in list_js, "listing form script should post the image files and ask for JSON")
check('headers: { "content-type": "application/json"' not in list_js, "listing form script should let the browser set the multipart boundary")
check("Use a JPEG, PNG, or WebP image." in list_js, "listing form script should reject other image types")
check("Keep each image under 2 MB." in list_js, "listing form script should cap each image")
check("Keep them under 8 MB altogether." in list_js, "listing form script should cap the images together")
check("—" not in list_js and "–" not in list_js, "listing form script should not use em or en dashes")
check(".required" not in list_js, "listing form script should not mark fields required in the browser")
check("Enter your name." in list_js and "Enter a valid email." in list_js, "listing form script should still require a name and email")
check("Confirm you are authorized" not in list_js, "listing form script should not require the authorization checkbox")
check("Thanks!  We will review and get back to you shortly." in list_js, "listing form script should thank the restaurant")
check(f"{build.ORIGIN}/list-your-restaurant/" in sitemap, "sitemap missing the listing form")
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
lead_at = about.find(build.ABOUT_LEAD)
story_at = about.find(build.ABOUT_STORY[0])
button_at = about.find(">See the restaurants</a>")
decal_at = about.find('class="window-decal"')
print_at = about.find('class="print-guides"')
check(0 <= lead_at < story_at < button_at < decal_at < print_at, "experience copy should sit under the intro and before the window decal")
decal_section = about.split('class="window-decal"', 1)[1].split("</aside>", 1)[0]
check('id="window-decal-heading">Get a Free Window Decal</h2>' in decal_section, "about page should use Marc's window decal heading")
check(
    "Own or manage a restaurant along 30A? We’ll send you a free “Proudly Listed on Eating on 30A” window decal to display at your restaurant." in decal_section,
    "about page should use Marc's window decal paragraph",
)
check(
    f'Just <a class="text-link" href="{build.e(build.window_decal_href())}">contact us</a> and we will personally drop one off!' in decal_section,
    "window decal note should link contact us and keep Marc's closing line",
)
check(
    'href="/list-your-restaurant/">listing form</a>' in decal_section,
    "window decal column should link the full listing form",
)
check("A free window decal" not in decal_section and "include the restaurant name" not in decal_section, "about page should drop the previous decal wording")
check("https://www.eatingon30a.com" not in decal_section, "decal note should use a relative contact link")
check(build.window_decal_href().startswith("/contact/?subject="), "window decal should use the contact subject query")
check(f'src="{build.WINDOW_DECAL_IMAGE}"' in decal_section and f'alt="{build.e(build.WINDOW_DECAL_ALT)}"' in decal_section, "about page should show the window decal image")
decal_file = ROOT / build.WINDOW_DECAL_IMAGE.lstrip("/")
check(decal_file.is_file() and decal_file.stat().st_size > 10_000, "missing window decal image")
check(".about-lead" in styles and ".window-decal" in styles, "about layout should style the decal column")
check(
    "grid-template-columns: minmax(0, 40rem) minmax(17rem, 21rem)" in styles,
    "about intro should keep the decal in the open column beside the copy",
)
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
    f'property="og:image" content="{build.ORIGIN}/images/hero-beachside-dining.jpg"' in home,
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
    check("<h1" in text and 'class="lede"' in text and 'class="card-grid"' in text, f"{area_page.parent.name} lost the town page")
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
check(config["origin"] == "https://www.eatingon30a.com", "public origin should be the live www host")
check("workers.dev" not in config["origin"], "public origin should not be the workers.dev preview")
check("openstreetmap.org" in site_js, "map tiles must be OpenStreetMap")
check('target="_blank"' not in site_js, "map popups and listing cards should stay in the same tab")
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
bbb = directory[directory.find('id="r-big-bad-breakfast-inlet-beach"'):]
bbb = bbb[: bbb.find("</article>") + len("</article>")]
check('class="card-link"' in bbb and 'href="/restaurants/big-bad-breakfast-inlet-beach/"' in bbb, "card link should open the profile")
check('class="save-slot"' in bbb, "directory cards should carry a save slot")
check('data-slug="big-bad-breakfast-inlet-beach"' in bbb, "save slot should include the slug")
check('data-name="Big Bad Breakfast"' in bbb, "save slot should include the name")
check('data-area="Inlet Beach | The Pointe"' in bbb, "save slot area should match the listing label")
check(bbb.find("</a>") < bbb.find('class="save-slot"'), "save controls should sit outside the card link")
check(directory.count('class="save-slot"') == len(restaurants), "every directory card should have one save slot")
check("save-slot" not in (ROOT / "guides" / "index.html").read_text(encoding="utf-8"), "guide teasers are not restaurant cards")
check("save-slot" not in (ROOT / "about" / "index.html").read_text(encoding="utf-8"), "pages without restaurant cards should not include save slots")
seaside_area = (ROOT / "areas" / "seaside" / "index.html").read_text(encoding="utf-8")
check('class="save-slot"' in seaside_area and 'data-slug="bud-and-alleys-seaside"' in seaside_area, "town pages should save from restaurant cards")
check(
    'class="save-slot"' in (ROOT / "guides" / "best-seafood-30a" / "index.html").read_text(encoding="utf-8"),
    "guide restaurant grids should save from the same card",
)
account_js = (ROOT / "account.js").read_text(encoding="utf-8")
check("mountCardSaves" in account_js and ".save-slot" in account_js, "account.js should mount saves on card slots")
check('"/api/account/saves"' in account_js and "cards-mounted" in account_js, "card saves should use the account API and refresh with the map list")
check("Want to try" in account_js and "Favorite" in account_js, "save buttons should keep the listing labels")
check("—" not in account_js and "–" not in account_js, "account copy should not use em or en dashes")

stinkys = (ROOT / "restaurants" / "stinkys-fish-camp-dune-allen-beach" / "index.html").read_text(encoding="utf-8")
check("/images/restaurants/stinkys-fish-camp-dune-allen-beach/01.jpg" in stinkys, "Stinky's should use the supplied cover")
check("/images/restaurants/stinkys-fish-camp-logo.jpg" in stinkys, "Stinky's logo should be a local file")
sons_logo = ROOT / "images" / "restaurants" / "3-sons-bar-b-q-logo.png"
check(sons_logo.is_file(), "3 Sons logo should be a local file")
check(sons_logo.stat().st_size < 150_000, "3 Sons logo should stay light for the web")
sons = (ROOT / "restaurants" / "3-sons-bar-b-q-dune-allen-beach" / "index.html").read_text(encoding="utf-8")
check("/images/restaurants/3-sons-bar-b-q-logo.png" in sons, "3 Sons listing should use the local logo")
check('class="logo"' in sons and 'class="hero-logo"' in sons, "3 Sons listing page should show the logo")
check(
    "https://www.eatingon30a.com/images/restaurants/3-sons-bar-b-q-logo.png" in sons,
    "3 Sons schema logo should be the local file",
)
sons_card = directory[directory.find('id="r-3-sons-bar-b-q-dune-allen-beach"'):]
sons_card = sons_card[:2200]
check('class="card-logo"' in sons_card and "/images/restaurants/3-sons-bar-b-q-logo.png" in sons_card, "3 Sons card should show the logo")
nigels_card = directory[directory.find('id="r-nigels-bananas-seaside"'):][:1800]
check('class="mono"' in nigels_card and "card-logo" not in nigels_card, "a listing without a logo should keep the monogram")
stinkys_card = directory[directory.find('id="r-stinkys-fish-camp-dune-allen-beach"'):][:1800]
check("/images/restaurants/stinkys-fish-camp-dune-allen-beach/01.jpg" in stinkys_card and "card-logo" not in stinkys_card, "Stinky's card should keep its cover photo")
logo_pages = [
    path.parent.name
    for path in (ROOT / "restaurants").glob("*/index.html")
    if "3-sons-bar-b-q-logo.png" in path.read_text(encoding="utf-8")
]
check(logo_pages == ["3-sons-bar-b-q-dune-allen-beach"], f"3 Sons logo should stay on its listing, got {logo_pages}")
nearby_media = [
    "redds-pub",
    "down-island-gulf-seafood",
    "98-bar-b-que",
    "don-pedros-mexican-restaurant",
    "outcast-bar-and-grill",
    "thai-chiang-rai",
    "fat-daddys-pizza",
    "vki-japanese-steak-house-and-sushi",
    "thai-elephant",
    "stock-and-brew-cafe",
    "cafe-aroma-inlet-beach",
]
for slug in nearby_media:
    logo_file = ROOT / "images" / "restaurants" / f"{slug}-logo.png"
    cover = ROOT / "images" / "restaurants" / slug / "01.jpg"
    check(logo_file.is_file() and logo_file.stat().st_size < 180_000, f"{slug} logo should be a local file")
    check(cover.is_file() and cover.stat().st_size < 500_000, f"{slug} should have a cover photo")
    page = (ROOT / "restaurants" / slug / "index.html").read_text(encoding="utf-8")
    check(f"/images/restaurants/{slug}-logo.png" in page and 'class="logo"' in page, f"{slug} listing should show the logo")
    hero = page.split('class="profile-hero"', 1)[1].split('class="wrap profile-head"', 1)[0]
    check(f"/images/restaurants/{slug}/01.jpg" in hero, f"{slug} hero should use the cover photo")
    card = directory[directory.find(f'id="r-{slug}"') :][:2200]
    check(f"/images/restaurants/{slug}/01.jpg" in card, f"{slug} card should use the cover photo")
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
    and "/images/restaurants/beach-happy-cafe-seagrove-beach/03.jpg" in happy
    and "/images/restaurants/beach-happy-cafe-seagrove-beach/04.jpg" not in happy
    and "/images/restaurants/beach-happy-cafe-seagrove-beach/05.jpg" not in happy,
    "Beach Happy Seagrove profile should show the extra photos",
)
seagrove_dir = ROOT / "images" / "restaurants" / "beach-happy-cafe-seagrove-beach"
watercolor_dir = ROOT / "images" / "restaurants" / "beach-happy-cafe-watercolor"
check(not (watercolor_dir / "07.jpg").exists(), "WaterColor should not keep a seventh frame")
check(
    not any((seagrove_dir / name).exists() for name in ("04.jpg", "05.jpg")),
    "Seagrove should not keep the extra frames",
)
check("Shannon" not in happy and "Chris" not in happy, "Beach Happy Seagrove should not name Shannon or Chris")
watercolor = (ROOT / "restaurants" / "beach-happy-cafe-watercolor" / "index.html").read_text(encoding="utf-8")
watercolor_hero = watercolor.split('class="profile-hero"', 1)[1].split('class="profile-film"', 1)[0]
check("/images/restaurants/beach-happy-cafe-watercolor/01.jpg" in watercolor_hero, "WaterColor hero should be the storefront")
check("/images/restaurants/beach-happy-cafe-watercolor/06.jpg" in watercolor, "WaterColor gallery should include the sixth frame")
check("/images/restaurants/beach-happy-cafe-watercolor/07.jpg" not in watercolor, "WaterColor gallery should not include a seventh frame")
check("Shannon" not in watercolor and "Chris" not in watercolor, "Beach Happy WaterColor should not name Shannon or Chris")
happy_url = "https://beachhappycafe.com/?utm_source=eatingon30a&utm_medium=referral"
shunk_url = "https://www.shunkgulley.com/?utm_source=eatingon30a&utm_medium=referral"
gallion_url = "https://gallions30a.com/?utm_source=eatingon30a&utm_medium=referral"
gallion_reserve = "https://www.gallions30a.com/?utm_source=eatingon30a&utm_medium=referral&utm_content=reservations"
check(happy.count(build.e(happy_url)) >= 2 and ">Visit website</a>" in happy, "Seagrove should link the Beach Happy site")
check(">Photo: Beach Happy Cafe</a>" in happy and ">Photo: Beach Happy Cafe</a>" in watercolor, "Beach Happy photos should be credited")
shunk = (ROOT / "restaurants" / "shunk-gulley-oyster-bar-gulf-place" / "index.html").read_text(encoding="utf-8")
gallion = (ROOT / "restaurants" / "gallions-rosemary-beach" / "index.html").read_text(encoding="utf-8")
check(shunk_url in shunk and ">Photo: Shunk Gulley Oyster Bar</a>" in shunk, "Shunk Gulley should credit its photos and link its site")
check("/images/restaurants/shunk-gulley-oyster-bar-gulf-place/03.jpg" in shunk, "Shunk Gulley should show the grouper as the third photo")
check(build.e(gallion_url) in gallion and build.e(gallion_reserve) in gallion and "opentable" not in gallion.lower(), "Gallion's reserve link should stay on the restaurant site")
check(">Photo: Gallion" in gallion, "Gallion's photos should be credited")
check("/images/restaurants/gallions-rosemary-beach/05.jpg" in gallion, "Gallion's should show the waffle frame")
website_hours = {
    "shunk-gulley-oyster-bar-gulf-place": shunk_url,
    "gallions-rosemary-beach": gallion_url,
    "beach-happy-cafe-seagrove-beach": happy_url,
    "beach-happy-cafe-watercolor": happy_url,
}
for slug, url in website_hours.items():
    row = full_by_slug[slug]
    page = {
        "shunk-gulley-oyster-bar-gulf-place": shunk,
        "gallions-rosemary-beach": gallion,
        "beach-happy-cafe-seagrove-beach": happy,
        "beach-happy-cafe-watercolor": watercolor,
    }[slug]
    facts = page.split('<dl class="facts">', 1)[1].split("</dl>", 1)[0]
    hours_dd = facts.split("<dt>Hours</dt><dd>", 1)[1].split("</dd>", 1)[0]
    expected = "Check " + build.external_link(url, "website") + " for hours"
    check(row["hours"] == "Check website for hours", f"{slug} hours should point to the website, got {row['hours']}")
    check(hours_dd == expected, f"{slug} Hours fact should link website, got {hours_dd}")
    check("See the current" in page and ">menu</a>" in page and ">hours</a>" in page and ">events</a>" in page, f"{slug} should keep the menu, hours, and events links")
    check("—" not in hours_dd and "–" not in hours_dd, f"{slug} Hours fact should not use a dash")
check(
    sorted(slug for slug, row in full_by_slug.items() if row.get("hours") == "Check website for hours") == sorted(website_hours),
    "only the Haley Miett listings should drop concrete hours",
)
pig = (ROOT / "restaurants" / "the-perfect-pig-watercolor" / "index.html").read_text(encoding="utf-8")
check("<dt>Hours</dt><dd>Daily 8am-9pm</dd>" in pig, "other listings should keep concrete hours")
check(build.clean_hours("Mon-Fri: Unknown Sat & Sun: Unknown") == "", "hours without a clock time should stay unlisted")
check(build.clean_hours("check website for hours") == "Check website for hours", "website hours phrase should survive the hours cleaner")
seagrove_row = full_by_slug["beach-happy-cafe-seagrove-beach"]
check(seagrove_row["meals"] == ["Drinks"], f"Seagrove meals should be drinks only, got {seagrove_row['meals']}")
check("Breakfast" not in seagrove_row["meals"] and "Lunch" not in seagrove_row["meals"], "Seagrove should not be a food meal")
check(seagrove_row["cuisines"] == ["Cafe"], f"Seagrove cuisine should be Cafe, got {seagrove_row['cuisines']}")
check(seagrove_row["foods"] == ["Coffee", "Smoothies"], f"Seagrove foods should be coffee and smoothies, got {seagrove_row['foods']}")
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
    card = home.split(f'href="/areas/{town_slug}/"', 1)[1].split("</a>", 1)[0]
    check('class="ph"' not in card, f"{town_slug} homepage card should not keep the placeholder")

nearby_rows = [item for item in source if item["areaSlug"] == "nearby"]
check(len(nearby_rows) == 17, f"Nearby should list 17 restaurants, got {len(nearby_rows)}")
check(any(item["slug"] == "cafe-aroma-inlet-beach" and item["areaSlug"] == "inlet-beach" for item in source), "Café Aroma should stay in Inlet Beach")
check("marco" not in {item["slug"] for item in source}, "Marco’s Pizza should stay off the guide")
nearby_src = "/images/areas/nearby.jpg"
nearby_file = ROOT / nearby_src.lstrip("/")
check(nearby_file.is_file(), "missing Nearby town photo")
check(nearby_file.stat().st_size < 400_000, "Nearby town photo too large for the web")
storefront = ROOT / "images" / "restaurants" / "stock-and-brew-cafe" / "01.jpg"
check(nearby_file.read_bytes() == storefront.read_bytes(), "Nearby town photo should be the Stock & Brew storefront")
nearby_page = (ROOT / "areas" / "nearby" / "index.html").read_text(encoding="utf-8")
nearby_hero = nearby_page.split('class="profile-hero"', 1)[1].split('class="wrap page-intro"', 1)[0]
check(f'src="{nearby_src}"' in nearby_hero and 'class="ph"' not in nearby_hero, "Nearby hero should be the storefront photo")
check('alt="Nearby on US 98, near Scenic Highway 30A"' in nearby_hero, "Nearby hero alt should name US 98 near 30A")
check(f'content="https://www.eatingon30a.com{nearby_src}"' in nearby_page, "Nearby Open Graph image should be the town photo")
check("og-scenic-30a.jpg" not in nearby_page, "Nearby page should not use the generic scenic image")
check("<h1 class=\"town-title\">Restaurants Nearby</h1>" in nearby_page, "Nearby town page heading")
check("Restaurants in Nearby" not in nearby_page and "restaurants in Nearby" not in nearby_page, "Nearby page should not say restaurants in Nearby")
check("Find restaurants Nearby on US 98, near Scenic Highway 30A." in nearby_page, "Nearby intro should say restaurants Nearby")
check("Restaurants Nearby on US 98, near Scenic Highway 30A." in llms, "llms.txt should say Restaurants Nearby")
check("Restaurants in Nearby" not in llms, "llms.txt should not say Restaurants in Nearby")
seaside_page = (ROOT / "areas" / "seaside" / "index.html").read_text(encoding="utf-8")
check("<h1 class=\"town-title\">Restaurants in Seaside</h1>" in seaside_page, "other towns keep Restaurants in {Town}")
check("on US 98, near Scenic Highway 30A" in nearby_page, "Nearby intro should name US 98 near 30A")
check("The guide lists" not in nearby_page, "Nearby intro should not hard-code a restaurant count")
nearby_title = nearby_page.split("<title>", 1)[1].split("</title>", 1)[0]
check("on 30A" not in nearby_title.replace("Eating on 30A", ""), f"Nearby title should not call the town on 30A: {nearby_title}")
nearby_meta = nearby_page.split('name="description" content="', 1)[1].split('"', 1)[0]
check("on 30A" not in nearby_meta and "on Scenic Highway 30A" not in nearby_meta, f"Nearby meta should not say on 30A: {nearby_meta}")
check('href="/restaurants/?area=nearby"' in home or 'href="/areas/nearby/"' in home, "homepage should browse Nearby")
check('value="nearby"' in directory, "directory town filter should include Nearby")
for item in nearby_rows:
    page = (ROOT / "restaurants" / item["slug"] / "index.html").read_text(encoding="utf-8")
    title = page.split("<title>", 1)[1].split("</title>", 1)[0]
    description = page.split('name="description" content="', 1)[1].split('"', 1)[0]
    check("on 30A" not in title.replace("Eating on 30A", ""), f"{item['slug']} title should not say on 30A: {title}")
    check("on 30A" not in description and "on Scenic Highway 30A" not in description, f"{item['slug']} meta should not say on 30A: {description}")
    check("Nearby | US 98" in page, f"{item['slug']} should show town and US 98")
    check("Nearby · US 98" in directory, "directory cards should show Nearby and US 98")

shared_header = (ROOT / "includes" / "header.html").read_text(encoding="utf-8")
shared_footer = (ROOT / "includes" / "footer.html").read_text(encoding="utf-8")
check('target="_blank"' not in shared_header, "header navigation should stay in the same tab")
check('target="_blank"' not in shared_footer, "footer links should stay in the same tab")
check('href="/restaurants/"' in shared_header and 'href="/map/"' in shared_header, "shared header is missing nav links")
check('href="/areas/"' in shared_header and 'href="/about/"' in shared_header, "shared header is missing town or about links")
check('href="/guides/"' in shared_header, "shared header is missing the guides link")
check('href="/contact/"' in shared_footer and "site-footer" in shared_footer, "shared footer is missing links")
check('href="/guides/"' in shared_footer, "shared footer is missing the guides link")
check('href="/guides/best-seafood-30a/"' in home and 'href="/guides/"' in home, "homepage should mention the guides")
check("Popular guides for a trip along Scenic Highway 30A." in home, "homepage guides mention should stay modest")
seafood = build.seafood_restaurants(source, build.load_areas(source))
check(len(seafood) == 33, f"seafood guide should list every Seafood cuisine row, got {len(seafood)}")
guide_index = (ROOT / "guides" / "index.html").read_text(encoding="utf-8")
seafood_page = (ROOT / "guides" / "best-seafood-30a" / "index.html").read_text(encoding="utf-8")
check("<h1>Guides along 30A</h1>" in guide_index, "guides index heading")
check('<h1 class="guide-title">Best seafood on 30A</h1>' in seafood_page, "seafood guide heading")
check('href="/restaurants/?cuisine=Seafood"' in seafood_page, "seafood guide should link the directory filter")
check('href="/map/?cuisine=Seafood"' in seafood_page, "seafood guide should link the map filter")
check('href="/restaurants/?cuisine=Seafood&amp;kids=yes"' in seafood_page, "seafood guide should link kid-friendly seafood")
check("FAQPage" in seafood_page, "seafood guide should include FAQ schema")
check("Where along 30A are the seafood restaurants?" in seafood_page, "seafood guide FAQ should say where along 30A")
check("kid-friendly seafood restaurants" in seafood_page, "seafood guide FAQ should cover kid-friendly seafood")
check("on the water?" in seafood_page, "seafood guide FAQ should cover waterfront seafood")
for restaurant in seafood:
    check(f'/restaurants/{restaurant["slug"]}/' in seafood_page, f"seafood guide missing {restaurant['slug']}")
check("/restaurants/o-ku-alys-beach/" not in seafood_page, "sushi-only listings are not the Seafood cuisine")
check("/restaurants/great-southern-cafe-seaside/" not in seafood_page, "a note that mentions Gulf seafood is not a Seafood tag")
check(f"{build.ORIGIN}/guides/" in sitemap and f"{build.ORIGIN}/guides/best-seafood-30a/" in sitemap, "sitemap missing guides")
guide_index = (ROOT / "guides" / "index.html").read_text(encoding="utf-8")
picks = build.guide_picks(source, build.load_areas(source))
check(len(picks) == 10, f"expected 10 guides, got {len(picks)}")
check([item["slug"] for item in picks][0] == "best-seafood-30a", "seafood guide should stay first")
for guide in picks:
    page = (ROOT / "guides" / guide["slug"] / "index.html").read_text(encoding="utf-8")
    check(f'<h1 class="guide-title">{guide["h1"]}</h1>' in page, f"guide heading {guide['slug']}")
    check("FAQPage" in page, f"guide FAQ schema {guide['slug']}")
    check(2 <= page.count("<h3>") <= 4, f"guide FAQ count {guide['slug']}")
    check(build.e(guide["directory_href"]) in page, f"directory filter missing {guide['slug']}")
    check(build.e(guide["map_href"]) in page, f"map filter missing {guide['slug']}")
    check(guide["path"] in guide_index, f"guides index missing {guide['slug']}")
    chosen = {restaurant["slug"] for restaurant in guide["restaurants"]}
    for restaurant in source:
        present = f"/restaurants/{restaurant['slug']}/" in page
        if restaurant["slug"] in chosen:
            check(present, f"{guide['slug']} missing {restaurant['slug']}")
        else:
            check(not present, f"{guide['slug']} should not list {restaurant['slug']}")
    check(f"{build.ORIGIN}{guide['path']}" in sitemap, f"sitemap missing {guide['slug']}")
check("doesn’t score a restaurant as walkable" in (ROOT / "guides" / "walkable-30a" / "index.html").read_text(encoding="utf-8"), "walkable guide should say it isn’t a walk score")
check("doesn’t have brunch as its own meal" in (ROOT / "guides" / "coffee-brunch-30a" / "index.html").read_text(encoding="utf-8"), "coffee guide should say 30A has no brunch meal")
nearby_guide = (ROOT / "guides" / "nearby-us-98" / "index.html").read_text(encoding="utf-8")
check("<h1 class=\"guide-title\">Restaurants near 30A on US 98</h1>" in nearby_guide, "nearby guide heading")
check("They are not on 30A." in nearby_guide, "nearby guide should say these restaurants are not on 30A")
check('href="/areas/nearby/"' in nearby_guide, "nearby guide should link the Nearby town page")
check('href="https://www.eatingindestin.com/"' in nearby_guide, "nearby guide should link Eating in Destin")
check("Live music is seasonal and subject to change. Confirm with the restaurant." in nearby_guide, "nearby guide should keep the live music note")
check("—" not in nearby_guide and "–" not in nearby_guide, "nearby guide should not use em or en dashes")
check(
    'src="/images/areas/nearby.jpg"' in nearby_guide or 'src="/images/restaurants/stock-and-brew-cafe/01.jpg"' in nearby_guide,
    "nearby guide hero should use the Nearby photo or the Stock & Brew storefront",
)
for slug in (
    "redds-pub",
    "down-island-gulf-seafood",
    "98-bar-b-que",
    "don-pedros-mexican-restaurant",
    "outcast-bar-and-grill",
    "thai-chiang-rai",
    "fat-daddys-pizza",
    "vki-japanese-steak-house-and-sushi",
    "thai-elephant",
    "stock-and-brew-cafe",
):
    check(f'href="/restaurants/{slug}/"' in nearby_guide, f"nearby guide should link {slug}")
check("Short guides for planning a meal" not in guide_index, "guides index should drop the hub blurb")
check("organized from west to east so it’s easy to plan your stops" in seafood_page, "seafood guide should use Marc’s intro")
check("fried shrimp baskets" in seafood_page, "seafood guide should keep the practical seafood range")
breakfast_guide = (ROOT / "guides" / "breakfast-30a" / "index.html").read_text(encoding="utf-8")
check("listed west to east" not in breakfast_guide, "breakfast guide should not say listed west to east")
check("isn’t kid friendly" not in breakfast_guide and "aren't kid friendly" not in breakfast_guide, "breakfast guide should not single out a place as not kid friendly")
check("pickles-sandbar-seaside" not in breakfast_guide, "breakfast guide should not include Pickle’s Sandbar")
check("/restaurants/pickles-burger-and-shake-seaside/" in breakfast_guide, "breakfast guide should include Pickle’s Burger and Shake")
check("/restaurants/beach-happy-cafe-seagrove-beach/" not in breakfast_guide, "breakfast guide should not include Beach Happy Seagrove")
check("/restaurants/beach-happy-cafe-watercolor/" in breakfast_guide, "breakfast guide should keep Beach Happy WaterColor")
coffee_guide = (ROOT / "guides" / "coffee-brunch-30a" / "index.html").read_text(encoding="utf-8")
check("/restaurants/beach-happy-cafe-seagrove-beach/" in coffee_guide, "coffee guide should keep Beach Happy Seagrove")
check(not (ROOT / "restaurants" / "pickles-sandbar-seaside" / "index.html").exists(), "Pickle’s Sandbar listing should be removed")
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
check("Yes, I want coupons or updates!" in shared_footer and 'name="email"' in shared_footer and 'name="coupons"' in shared_footer, "footer subscribe is missing the signup fields")
check("Yes, I want coupons!" not in shared_footer and "Exclusive restaurant coupons" not in shared_footer, "subscribe copy should not be coupons-only")
check(">Local<" in shared_footer and ">Visitor<" in shared_footer, "footer subscribe should offer Local and Visitor")
check(
    'id="subscribe-popup"' in shared_footer
    and "Coupons or restaurant updates" in shared_footer
    and "Subscribe to get coupons or restaurant updates!" in shared_footer,
    "subscribe popup and footer should offer coupons or updates",
)
subscribe_js = (ROOT / "subscribe.js").read_text(encoding="utf-8")
check("30000" in subscribe_js and "localStorage" in subscribe_js, "popup should wait 30s and remember dismiss in localStorage")
check("We’ll send coupons or updates to that address." in subscribe_js, "delivered signup should mention coupons or updates")
check("We’ll send coupons to that address." not in subscribe_js, "success message should not be coupons-only")
worker_js = (ROOT / "worker.js").read_text(encoding="utf-8")
check("CONTACT_EMAIL" in worker_js and "RESEND_API_KEY" in worker_js and "SUBSCRIBE_FROM" in worker_js, "signup mail should name its env vars")
check('pathname === "/api/listing"' in worker_js and "reply_to" in worker_js, "listing mail should use the same Resend secrets and a reply address")
check('other: "Other"' in worker_js, "worker should accept an Other listing request")
check("Enter the restaurant name." not in worker_js, "worker should not require a restaurant name")
check(
    "fbevents.js" in worker_js
    and "fbq('init', '${META_PIXEL_ID}')" in worker_js
    and "fbq('track', 'PageView')" in worker_js
    and "tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1" in worker_js
    and f'const META_PIXEL_ID = "{build.META_PIXEL_ID}"' in worker_js,
    "form thanks pages should include the Meta pixel head code and noscript image",
)
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
    blanks = text.count('target="_blank"')
    parts = page.relative_to(ROOT).parts
    if len(parts) == 3 and parts[0] == "restaurants" and parts[2] == "index.html":
        site = full_by_slug[parts[1]]["website"]
        expected = build.external_link_count(full_by_slug[parts[1]])
        check(blanks == expected, f"{rel} should open the website and note links in a new tab, got {blanks}")
        if site:
            check(build.website_link(site) in text, f"{rel} website link is missing new-tab attributes")
    elif rel == "map/index.html":
        check(blanks == 1, f"{rel} should open only the 360 film in a new tab, got {blanks}")
    else:
        check(blanks == 0, f"{rel} should keep links in the same tab")
    check(text.count(build.GA_MEASUREMENT_ID) == 2, f"{rel} should include {build.GA_MEASUREMENT_ID} once in the loader and once in gtag config")
    check(
        text.count(f"https://www.googletagmanager.com/gtag/js?id={build.GA_MEASUREMENT_ID}") == 1,
        f"{rel} should load gtag.js once",
    )
    check(
        text.count(f"gtag('config', '{build.GA_MEASUREMENT_ID}')") == 1,
        f"{rel} should configure GA4 once",
    )
    head, _, _ = text.partition("</head>")
    check(
        head.count(f"fbq('init', '{build.META_PIXEL_ID}')") == 1,
        f"{rel} should init the Meta pixel once in the head",
    )
    check(
        head.count("fbq('track', 'PageView')") == 1,
        f"{rel} should track Meta PageView once in the head",
    )
    check(
        head.count("https://connect.facebook.net/en_US/fbevents.js") == 1,
        f"{rel} should load fbevents.js once in the head",
    )
    body_open = re.search(r"<body(?: class=\"home\")?>\n", text)
    check(body_open is not None, f"{rel} should have a body tag")
    if body_open:
        check(
            text.startswith(build.META_PIXEL_NOSCRIPT, body_open.end()),
            f"{rel} should place the Meta noscript immediately after body",
        )
    check(text.count(build.META_PIXEL_ID) == 2, f"{rel} should include {build.META_PIXEL_ID} once in init and once in the noscript image")
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
