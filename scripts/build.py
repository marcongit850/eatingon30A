#!/usr/bin/env python3
"""Build the Eating on 30A static site from data/*.csv.

Edit the CSVs, then run: python3 scripts/build.py
"""

from __future__ import annotations

import csv
import html
import json
import re
import shutil
import unicodedata
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG = json.loads((ROOT / "site.config.json").read_text(encoding="utf-8"))
ORIGIN = CONFIG["origin"].rstrip("/")

WEST_TO_EAST = [
    "dune-allen-beach",
    "gulf-place",
    "blue-mountain-beach",
    "grayton-beach",
    "watercolor",
    "seaside",
    "seagrove-beach",
    "seacrest",
    "watersound",
    "alys-beach",
    "rosemary-beach",
    "inlet-beach",
    "watersound-origins",
]

SHORT_NAMES = {
    "dune-allen-beach": "Dune Allen",
    "gulf-place": "Gulf Place",
    "blue-mountain-beach": "Blue Mountain",
    "grayton-beach": "Grayton",
    "watercolor": "WaterColor",
    "seaside": "Seaside",
    "seagrove-beach": "Seagrove",
    "seacrest": "Seacrest",
    "watersound": "Watersound",
    "alys-beach": "Alys Beach",
    "rosemary-beach": "Rosemary",
    "inlet-beach": "Inlet Beach",
    "watersound-origins": "Watersound Origins",
}

FALLBACK_COPY = {
    "watersound": "A beach stretch east of Seagrove, with casual dining along County Highway 30A.",
    "watersound-origins": "An inland town center north of 30A, with everyday restaurants around the square.",
}

MEAL_ORDER = ["Breakfast", "Lunch", "Dinner", "Desserts", "Drinks"]

# Phase 1 shell. These slugs are the only listings published to the site.
# data/restaurants.csv still holds the full export. Set this to None after
# visual sign-off to generate a page for every PUBLISHED row.
SAMPLE_SLUGS = [
    "stinkys-fish-camp-dune-allen-beach",
    "the-red-bar-grayton-beach",
    "hurricane-oyster-bar-grayton-beach",
    "pizza-by-the-sea-watercolor",
    "bud-and-alleys-seaside",
    "amavida-coffee-roasters-seaside",
    "big-bad-breakfast-inlet-beach",
    "georges-at-alys-beach-alys-beach",
    "neat-bottle-shop-and-tasting-room-alys-beach",
    "sugar-shak-rosemary-beach",
]

# The Wix export's detail photo for this restaurant is a multi-megabyte PNG.
# The same frame is committed as a compressed JPEG. The CSV stays the source.
LOCAL_WIX_FILES = {
    "de29ed_1a5c50c91a154838816cc7ea7b48a6c6~mv2.png": "/images/restaurants/stinkys-fish-camp.jpg",
}

ABOUT = (
    "Eating on 30A is a guide to restaurants along Scenic Highway 30A in Walton County, Florida. "
    "From casual beachside bites and fresh Gulf seafood to upscale dining and local favorites, "
    "the directory is meant to help you find a place by town, meal, or cuisine. "
    "Browse Dune Allen, Gulf Place, Blue Mountain, Grayton Beach, WaterColor, Seaside, Seagrove, "
    "Seacrest, Watersound, Alys Beach, Rosemary Beach, Inlet Beach, and Watersound Origins."
)


def e(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def slugify(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text or "restaurant"


def parse_list(raw: str) -> list[str]:
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return [raw]
    if isinstance(value, list):
        items = [str(item).strip() for item in value]
    elif isinstance(value, str):
        items = [value.strip()]
    else:
        items = []
    return [item for item in items if item and item.upper() != "TBD"]


def is_yes(raw: str) -> bool:
    return any(item.lower() in {"yes", "occasional"} for item in parse_list(raw))


def clean_text(raw: str) -> str:
    return re.sub(r"\s+", " ", (raw or "").replace("\u00a0", " ")).strip()


def clean_hours(raw: str) -> str:
    text = clean_text(raw)
    if not text or not re.search(r"\d", text):
        return ""
    return text


def parse_address(raw: str) -> dict:
    empty = {"formatted": "", "lat": None, "lng": None, "postal": "", "street": "", "region": "FL"}
    raw = (raw or "").strip()
    if not raw:
        return empty
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        empty["formatted"] = raw
        return empty
    if not isinstance(data, dict):
        return empty
    loc = data.get("location") or {}
    street = data.get("streetAddress") or {}
    number = clean_text(street.get("number") or "")
    name = clean_text(street.get("name") or "")
    apt = clean_text(street.get("apt") or "")
    line = " ".join(part for part in (number, name) if part)
    if apt:
        line = f"{line}, {apt}" if line else apt
    lat = loc.get("latitude")
    lng = loc.get("longitude")
    try:
        lat = float(lat) if lat not in (None, "") else None
        lng = float(lng) if lng not in (None, "") else None
    except (TypeError, ValueError):
        lat = lng = None
    return {
        "formatted": clean_text(data.get("formatted") or ""),
        "lat": lat,
        "lng": lng,
        "postal": clean_text(data.get("postalCode") or ""),
        "street": line,
        "region": clean_text(data.get("subdivision") or "") or "FL",
    }


def wix_to_url(raw: str, width: int, height: int) -> str | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://")):
        return raw
    match = re.match(r"wix:image://v1/([^/#]+)/([^#]*)", raw)
    if not match:
        return None
    file_id, name = match.group(1), unquote(match.group(2))
    if "heart" in name.lower() and "shape" in name.lower():
        return None
    if file_id in LOCAL_WIX_FILES:
        return LOCAL_WIX_FILES[file_id]
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", name) or "photo.jpg"
    return (
        f"https://static.wixstatic.com/media/{file_id}/v1/fill/"
        f"w_{width},h_{height},al_c,q_75,enc_auto/{safe}"
    )


def tel_href(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        return f"tel:+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"tel:+{digits}"
    return f"tel:{digits}" if digits else ""


def website_href(raw: str) -> str:
    raw = clean_text(raw)
    if not raw:
        return ""
    if raw.startswith(("http://", "https://")):
        return raw
    return "https://" + raw


def tone_for(cuisines: list[str], foods: list[str], category: str) -> str:
    blob = " ".join(cuisines + foods + [category]).lower()
    if any(word in blob for word in ("coffee", "cafe", "donut")):
        return "coffee"
    if any(word in blob for word in ("dessert", "ice cream", "chocolate", "sweet")):
        return "sweet"
    if "pizza" in blob or "italian" in blob:
        return "italian"
    if "sushi" in blob or "japanese" in blob:
        return "sushi"
    if any(word in blob for word in ("seafood", "oyster", "fish")):
        return "seafood"
    if "burger" in blob:
        return "burger"
    if any(word in blob for word in ("mexican", "taco", "latin")):
        return "spice"
    if any(word in blob for word in ("wine", "bar")):
        return "wine"
    return "gulf"


def snippet(text: str, limit: int = 150) -> str:
    text = clean_text(text)
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(".,;:") + "…"


def ymd(value: str) -> str:
    value = (value or "").strip()
    return value[:10] if re.match(r"\d{4}-\d{2}-\d{2}", value) else ""


def load_rows(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def unique_slug(base: str, used: set[str]) -> str:
    slug = base or "restaurant"
    if slug not in used:
        used.add(slug)
        return slug
    number = 2
    while f"{slug}-{number}" in used:
        number += 1
    slug = f"{slug}-{number}"
    used.add(slug)
    return slug


def load_restaurants() -> list[dict]:
    used: set[str] = set()
    restaurants = []
    for row in load_rows(DATA / "restaurants.csv"):
        if clean_text(row.get("Status")) != "PUBLISHED":
            continue
        name = clean_text(row.get("Restaurant Name"))
        area_slug = slugify(row.get("map_area_slug") or row.get("map_area") or "30a")
        given = clean_text(row.get("slug"))
        if given:
            base = slugify(given)
        else:
            item = clean_text(row.get("Restaurants (Item)"))
            tail = unquote(item.rstrip("/").split("/")[-1]) if item else ""
            base = slugify(tail) if tail else slugify(f"{name}-{area_slug}")
        slug = unique_slug(base, used)
        address = parse_address(row.get("address") or "")
        cuisines = parse_list(row.get("Cuisine Type"))
        meals = parse_list(row.get("Meal Type"))
        foods = parse_list(row.get("Food Type"))
        vibes = parse_list(row.get("Vibe"))
        categories = parse_list(row.get("Category"))
        category = categories[0] if categories else ""
        area = clean_text(row.get("map_area")) or SHORT_NAMES.get(area_slug, area_slug)
        subarea = clean_text(row.get("subarea"))
        notes = clean_text(row.get("notes"))
        phone = clean_text(row.get("phone"))
        list_image = wix_to_url(row.get("List Image") or "", 960, 600)
        detail_image = wix_to_url(row.get("Detail Image") or "", 1400, 780)
        logo = wix_to_url(row.get("Logo") or "", 400, 300)
        card_image = list_image or detail_image
        hero_image = detail_image or list_image
        search = " ".join(
            [
                name,
                area,
                subarea,
                clean_text(row.get("location_label")),
                " ".join(cuisines),
                " ".join(meals),
                " ".join(foods),
                category,
                notes,
                clean_text(row.get("Search Terms")),
                clean_text(row.get("price")),
            ]
        ).lower()
        restaurants.append(
            {
                "slug": slug,
                "name": name,
                "area": area,
                "areaSlug": area_slug,
                "subarea": subarea,
                "label": clean_text(row.get("location_label")),
                "address": address["formatted"],
                "street": address["street"],
                "postal": address["postal"],
                "region": address["region"],
                "lat": address["lat"],
                "lng": address["lng"],
                "phone": phone,
                "tel": tel_href(phone),
                "website": website_href(row.get("website") or ""),
                "price": clean_text(row.get("price")),
                "notes": notes,
                "hours": clean_hours(row.get("hours") or ""),
                "cuisines": cuisines,
                "meals": meals,
                "foods": foods,
                "vibes": vibes,
                "category": category,
                "outdoor": is_yes(row.get("Outdoor Dining")),
                "kids": is_yes(row.get("Kid Friendly")),
                "music": is_yes(row.get("Live Music")),
                "happyDrinks": is_yes(row.get("Happy Hour (drinks)")),
                "happyFood": is_yes(row.get("Happy Hour (food)")),
                "reservations": is_yes(row.get("Reservations")),
                "facebook": website_href(row.get("Facebook URL") or ""),
                "instagram": website_href(row.get("Instagram") or ""),
                "cardImage": card_image,
                "heroImage": hero_image,
                "logo": logo,
                "tone": tone_for(cuisines, foods, category),
                "search": search,
                "updated": ymd(row.get("Updated Date") or ""),
            }
        )
    restaurants.sort(key=lambda item: item["name"].lower())
    return restaurants


def published_restaurants() -> list[dict]:
    """Listings that should appear on the site. The shell uses SAMPLE_SLUGS."""
    restaurants = load_restaurants()
    if not SAMPLE_SLUGS:
        return restaurants
    by_slug = {restaurant["slug"]: restaurant for restaurant in restaurants}
    missing = [slug for slug in SAMPLE_SLUGS if slug not in by_slug]
    if missing:
        raise SystemExit("Sample slugs missing from data/restaurants.csv: " + ", ".join(missing))
    return [by_slug[slug] for slug in SAMPLE_SLUGS]


def sample_banner() -> str:
    if not SAMPLE_SLUGS:
        return ""
    return (
        '<p class="sample-banner">Design preview. These pages use a sample of listings so the look and filters can be approved. '
        "The full restaurant CSV stays in the project and is not on the site yet.</p>"
    )


def load_areas(restaurants: list[dict]) -> list[dict]:
    by_slug: dict[str, dict] = {}
    for row in load_rows(DATA / "locations.csv"):
        if clean_text(row.get("Status")) not in {"", "PUBLISHED"}:
            continue
        slug = slugify(row.get("area_slug") or "")
        if not slug or slug == "30a":
            continue
        by_slug[slug] = {
            "slug": slug,
            "name": SHORT_NAMES.get(slug) or clean_text(row.get("area_name")).title(),
            "fullName": "",
            "description": clean_text(row.get("description")) or FALLBACK_COPY.get(slug, ""),
            "image": wix_to_url(row.get("Location Image") or "", 1200, 800),
            "video": clean_text(row.get("VideoURL")),
        }
    for slug, copy in FALLBACK_COPY.items():
        by_slug.setdefault(
            slug,
            {
                "slug": slug,
                "name": SHORT_NAMES.get(slug, slug),
                "fullName": "",
                "description": copy,
                "image": None,
                "video": "",
            },
        )
    counts: dict[str, int] = {}
    full_names: dict[str, str] = {}
    for restaurant in restaurants:
        counts[restaurant["areaSlug"]] = counts.get(restaurant["areaSlug"], 0) + 1
        full_names.setdefault(restaurant["areaSlug"], restaurant["area"])
        if restaurant["areaSlug"] not in by_slug:
            by_slug[restaurant["areaSlug"]] = {
                "slug": restaurant["areaSlug"],
                "name": SHORT_NAMES.get(restaurant["areaSlug"], restaurant["area"]),
                "fullName": restaurant["area"],
                "description": FALLBACK_COPY.get(restaurant["areaSlug"], ""),
                "image": None,
                "video": "",
            }
    ordered = []
    seen = set()
    for slug in WEST_TO_EAST + sorted(by_slug):
        if slug in seen or slug not in by_slug or counts.get(slug, 0) == 0:
            continue
        seen.add(slug)
        area = by_slug[slug]
        area["fullName"] = full_names.get(slug, area["name"])
        area["name"] = SHORT_NAMES.get(slug, area["fullName"])
        area["count"] = counts[slug]
        ordered.append(area)
    return ordered


def hero_image() -> str | None:
    for row in load_rows(DATA / "locations.csv"):
        if slugify(row.get("area_slug") or "") == "30a":
            return wix_to_url(row.get("Location Image") or "", 1800, 1200)
    return None


def shot_label(restaurant: dict) -> str:
    if restaurant["foods"]:
        return restaurant["foods"][0]
    if restaurant["cuisines"]:
        return restaurant["cuisines"][0]
    return restaurant["area"]


def placeholder(tone: str, label: str) -> str:
    return f'<div class="ph" data-tone="{e(tone)}"><span>{e(label)}</span></div>'


def media_block(image: str | None, alt: str, tone: str, label: str, eager: bool = False) -> str:
    if not image:
        return placeholder(tone, label)
    loading = "eager" if eager else "lazy"
    return (
        f'<img src="{e(image)}" alt="{e(alt)}" loading="{loading}" '
        'onerror="var p=this.parentElement;this.remove();var f=p&&p.querySelector(\'.ph\');if(f)f.hidden=false">'
        f'<div class="ph" data-tone="{e(tone)}" hidden><span>{e(label)}</span></div>'
    )


def card(restaurant: dict, heading: str = "h2") -> str:
    meals = " · ".join(restaurant["meals"])
    cuisines = ", ".join(restaurant["cuisines"])
    bits = [bit for bit in (restaurant["price"], cuisines, meals) if bit]
    label = shot_label(restaurant)
    area_line = restaurant["area"]
    if restaurant["subarea"]:
        area_line += f" · {restaurant['subarea']}"
    yes_no = lambda flag: "yes" if flag else "no"
    attrs = " ".join(
        [
            f'id="r-{e(restaurant["slug"])}"',
            f'href="/restaurants/{e(restaurant["slug"])}/"',
            'class="card"',
            f'data-area="{e(restaurant["areaSlug"])}"',
            f'data-meals="{e("|".join(restaurant["meals"]))}"',
            f'data-cuisines="{e("|".join(restaurant["cuisines"]))}"',
            f'data-outdoor="{yes_no(restaurant["outdoor"])}"',
            f'data-kids="{yes_no(restaurant["kids"])}"',
            f'data-music="{yes_no(restaurant["music"])}"',
            f'data-search="{e(restaurant["search"])}"',
        ]
    )
    note = snippet(restaurant["notes"])
    note_html = f'<p class="note">{e(note)}</p>' if note else ""
    return (
        f'<a {attrs}>'
        f'<div class="card-media">{media_block(restaurant["cardImage"], restaurant["name"], restaurant["tone"], label)}</div>'
        f'<div class="card-body"><p class="card-area">{e(area_line)}</p>'
        f'<{heading}>{e(restaurant["name"])}</{heading}>'
        f'<p class="meta">{e(" · ".join(bits))}</p>{note_html}</div></a>'
    )


def header(active: str) -> str:
    items = [
        ("restaurants", "/restaurants/", "Restaurants"),
        ("map", "/map/", "Map"),
        ("areas", "/areas/", "Towns"),
        ("about", "/about/", "About"),
    ]
    links = []
    for key, href, label in items:
        current = ' aria-current="page"' if key == active else ""
        links.append(f'<a href="{href}"{current}>{label}</a>')
    return (
        '<a class="skip" href="#main">Skip to content</a>'
        '<header class="site-header"><div class="wrap header-inner">'
        '<a class="brand" href="/"><strong>Eating on 30A</strong><span>Restaurant guide</span></a>'
        f'<nav class="nav" aria-label="Primary">{"".join(links)}</nav>'
        "</div></header>"
    )


def footer() -> str:
    return (
        '<footer class="site-footer"><div class="wrap footer-inner">'
        "<p>Eating on 30A · restaurants along Scenic Highway 30A, Walton County, Florida.</p>"
        '<nav aria-label="Footer">'
        '<a href="/restaurants/">Restaurants</a>'
        '<a href="/map/">Map</a>'
        '<a href="/areas/">Towns</a>'
        '<a href="/about/">About</a>'
        '<a href="/contact/">Contact</a>'
        "</nav></div></footer>"
    )


def layout(title: str, description: str, path: str, active: str, body: str, extra_head: str = "", include_js: bool = True) -> str:
    canonical = ORIGIN + path
    scripts = '<script type="module" src="/site.js"></script>' if include_js else ""
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{e(title)}</title>\n"
        f'<meta name="description" content="{e(description)}">\n'
        f'<link rel="canonical" href="{e(canonical)}">\n'
        '<meta name="theme-color" content="#0c3f3c">\n'
        '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,650&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">\n'
        '<link rel="stylesheet" href="/styles.css">\n'
        '<meta property="og:site_name" content="Eating on 30A">\n'
        '<meta property="og:type" content="website">\n'
        f'<meta property="og:title" content="{e(title)}">\n'
        f'<meta property="og:description" content="{e(description)}">\n'
        f'<meta property="og:url" content="{e(canonical)}">\n'
        '<meta name="twitter:card" content="summary_large_image">\n'
        + extra_head
        + "</head>\n<body>\n"
        + header(active)
        + sample_banner()
        + '<main id="main">\n'
        + body
        + "</main>\n"
        + footer()
        + scripts
        + "\n</body>\n</html>\n"
    )


def json_ld(data: dict | list) -> str:
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    return f'<script type="application/ld+json">{payload}</script>\n'


def area_names(areas: list[dict]) -> str:
    payload = {area["slug"]: area["fullName"] for area in areas}
    return json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")


def filter_form(areas: list[dict], cuisines: list[str]) -> str:
    area_options = ['<option value="">All towns</option>']
    for area in areas:
        area_options.append(f'<option value="{e(area["slug"])}">{e(area["fullName"])}</option>')
    meal_options = ['<option value="">Any meal</option>']
    for meal in MEAL_ORDER:
        meal_options.append(f'<option value="{e(meal)}">{e(meal)}</option>')
    cuisine_options = ['<option value="">Any cuisine</option>']
    for cuisine in cuisines:
        cuisine_options.append(f'<option value="{e(cuisine)}">{e(cuisine)}</option>')
    return (
        '<form id="filters" class="filters" action="/restaurants/" method="get">'
        '<label class="field"><span>Search</span><input id="q" name="q" type="search" placeholder="Name, seafood, pizza, coffee…"></label>'
        f'<label class="field"><span>Town</span><select id="area" name="area">{"".join(area_options)}</select></label>'
        f'<label class="field"><span>Meal</span><select id="meal" name="meal">{"".join(meal_options)}</select></label>'
        f'<label class="field"><span>Cuisine</span><select id="cuisine" name="cuisine">{"".join(cuisine_options)}</select></label>'
        '<div class="checks">'
        '<label><input type="checkbox" name="outdoor" value="yes"> Outdoor dining</label>'
        '<label><input type="checkbox" name="kids" value="yes"> Kid friendly</label>'
        '<label><input type="checkbox" name="music" value="yes"> Live music</label>'
        "</div>"
        '<div class="filter-actions"><button type="submit">Apply</button><a href="/restaurants/">Clear</a></div>'
        "</form>"
        f'<script type="application/json" id="area-names">{area_names(areas)}</script>'
    )


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def public_record(restaurant: dict) -> dict:
    return {
        "slug": restaurant["slug"],
        "name": restaurant["name"],
        "area": restaurant["area"],
        "areaSlug": restaurant["areaSlug"],
        "meals": restaurant["meals"],
        "cuisines": restaurant["cuisines"],
        "foods": restaurant["foods"],
        "price": restaurant["price"],
        "lat": restaurant["lat"],
        "lng": restaurant["lng"],
        "address": restaurant["address"],
        "phone": restaurant["phone"],
        "search": restaurant["search"],
        "outdoor": restaurant["outdoor"],
        "kids": restaurant["kids"],
        "music": restaurant["music"],
        "image": restaurant["cardImage"],
    }


def build_home(restaurants: list[dict], areas: list[dict], hero: str | None) -> None:
    meal_counts = []
    for meal in MEAL_ORDER:
        count = sum(1 for restaurant in restaurants if meal in restaurant["meals"])
        if count:
            meal_counts.append((meal, count))
    meals_html = "".join(
        f'<a href="/restaurants/?meal={e(meal)}"><span>{e(meal)}</span><strong>{count}</strong></a>'
        for meal, count in meal_counts
    )
    towns = []
    for area in areas:
        photo = ""
        if area["image"]:
            photo = f'<img src="{e(area["image"])}" alt="" loading="lazy">'
        else:
            photo = placeholder("gulf", area["name"])
        towns.append(
            f'<a class="town" href="/restaurants/?area={e(area["slug"])}">'
            f"{photo}"
            f'<span class="town-copy"><strong>{e(area["name"])}</strong><small>{area["count"]} places</small></span>'
            "</a>"
        )
    hero_html = (
        f'<img class="hero-photo" src="{e(hero)}" alt="Turquoise Gulf water and white sand along Scenic Highway 30A" width="1800" height="1200">'
        if hero
        else ""
    )
    body = (
        '<section class="hero">'
        f"{hero_html}"
        '<div class="hero-copy"><div class="wrap">'
        '<p class="eyebrow">Scenic Highway 30A · South Walton</p>'
        "<h1>Find the best restaurants along 30A.</h1>"
        '<p class="lede">Your guide to dining on Florida’s Emerald Coast. Pick a meal or a town and the sample directory opens already filtered.</p>'
        '<form class="search-form" action="/restaurants/" method="get">'
        '<label class="field"><span class="visually-hidden" style="position:absolute;left:-999px">Search restaurants</span>'
        '<input name="q" type="search" placeholder="Try oysters, coffee, pizza…"></label>'
        "<button>Search</button></form>"
        f'<div class="meal-row">{meals_html}</div>'
        "</div></div></section>"
        '<section class="section"><div class="wrap">'
        '<div class="section-head"><div><p class="kicker">West to east</p><h2>Explore by town</h2></div>'
        "<p>Towns in this preview. Each one opens the directory with that area already selected.</p></div>"
        f'<div class="town-grid">{"".join(towns)}</div>'
        '<p class="meta" style="margin-top:1rem"><a href="/areas/">Read the town guides</a> · <a href="/map/">Open the map</a></p>'
        "</div></section>"
        '<section class="section" style="padding-top:0"><div class="wrap split">'
        f"<div class=\"prose\"><h2>A directory for the whole corridor</h2><p>{e(ABOUT)}</p>"
        "<p>This preview is the design shell. The full catalog is imported after the look and filters are signed off.</p>"
        '<p><a class="button" href="/restaurants/">Browse the sample</a></p></div>'
        '<aside class="prose"><div class="stat-row">'
        f"<p><strong>{len(restaurants)}</strong> sample listings</p>"
        f"<p><strong>{len(areas)}</strong> towns in this preview</p>"
        "</div><p>The map uses OpenStreetMap tiles. A card shows a photo when the listing has a working image URL, and a color block when it does not.</p></aside>"
        "</div></section>"
    )
    extra = json_ld(
        {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebSite",
                    "name": "Eating on 30A",
                    "url": ORIGIN + "/",
                    "description": ABOUT,
                    "potentialAction": {
                        "@type": "SearchAction",
                        "target": ORIGIN + "/restaurants/?q={search_term_string}",
                        "query-input": "required name=search_term_string",
                    },
                },
                {
                    "@type": "ItemList",
                    "name": "Towns along 30A",
                    "itemListElement": [
                        {
                            "@type": "ListItem",
                            "position": index,
                            "name": area["fullName"],
                            "url": f"{ORIGIN}/restaurants/?area={area['slug']}",
                        }
                        for index, area in enumerate(areas, start=1)
                    ],
                },
            ],
        }
    )
    if hero:
        extra += f'<meta property="og:image" content="{e(hero)}">\n'
    write(
        ROOT / "index.html",
        layout(
            "Eating on 30A | Restaurant guide for Scenic Highway 30A",
            "Find restaurants along Scenic Highway 30A by meal, town, or cuisine. Breakfast, lunch, dinner, and the map.",
            "/",
            "home",
            body,
            extra,
        ),
    )


def build_directory(restaurants: list[dict], areas: list[dict], cuisines: list[str]) -> None:
    pending = (
        "<script>!function(){var p=new URLSearchParams(location.search);"
        "['meal','area','cuisine','q','outdoor','kids','music'].some(function(k){return p.get(k)})"
        "&&document.documentElement.classList.add('js-filter')}();</script>\n"
    )
    cards = "".join(card(restaurant) for restaurant in restaurants)
    body = (
        '<div class="wrap page-intro"><p class="kicker">Directory</p>'
        '<h1 id="listing-title">Sample directory</h1>'
        "<p class=\"lede\">Filter by town, meal, or cuisine. Homepage shortcuts land here with the matching filter already on. Only the sample listings are loaded.</p>"
        f"{filter_form(areas, cuisines)}"
        f'<p id="result-count" class="count" aria-live="polite">{len(restaurants)} restaurants</p>'
        f'<p id="empty" class="empty" hidden>No restaurants match. <a href="/restaurants/">Clear the filters</a>.</p>'
        f'<div id="cards" class="card-grid">{cards}</div></div>'
    )
    extra = pending + json_ld(
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": "Restaurants along 30A",
            "numberOfItems": len(restaurants),
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": index,
                    "name": restaurant["name"],
                    "url": f"{ORIGIN}/restaurants/{restaurant['slug']}/",
                }
                for index, restaurant in enumerate(restaurants, start=1)
            ],
        }
    )
    write(
        ROOT / "restaurants" / "index.html",
        layout(
            "Restaurants along 30A | Eating on 30A",
            "Search restaurants on Scenic Highway 30A by town, meal, and cuisine.",
            "/restaurants/",
            "restaurants",
            body,
            extra,
        ),
    )


def fact(label: str, value: str) -> str:
    if not value:
        return ""
    return f"<div><dt>{e(label)}</dt><dd>{value}</dd></div>"


def build_detail(restaurant: dict, restaurants: list[dict]) -> None:
    chips = []
    for meal in restaurant["meals"]:
        chips.append(f'<li><a href="/restaurants/?meal={e(meal)}">{e(meal)}</a></li>')
    for cuisine in restaurant["cuisines"]:
        chips.append(f'<li><a href="/restaurants/?cuisine={e(cuisine)}">{e(cuisine)}</a></li>')
    if restaurant["price"]:
        chips.append(f'<li>{e(restaurant["price"])}</li>')
    flags = []
    if restaurant["outdoor"]:
        flags.append("Outdoor dining")
    if restaurant["kids"]:
        flags.append("Kid friendly")
    if restaurant["music"]:
        flags.append("Live music")
    if restaurant["happyDrinks"]:
        flags.append("Happy hour drinks")
    if restaurant["happyFood"]:
        flags.append("Happy hour food")
    if restaurant["reservations"]:
        flags.append("Takes reservations")
    for flag in flags:
        chips.append(f"<li>{e(flag)}</li>")
    phone = f'<a href="{e(restaurant["tel"])}">{e(restaurant["phone"])}</a>' if restaurant["tel"] else ""
    website = (
        f'<a href="{e(restaurant["website"])}" rel="noopener noreferrer">{e(restaurant["website"].removeprefix("https://").removeprefix("http://"))}</a>'
        if restaurant["website"]
        else ""
    )
    directions = ""
    if restaurant["lat"] is not None and restaurant["lng"] is not None:
        directions = (
            f'<a href="https://www.openstreetmap.org/?mlat={restaurant["lat"]}&amp;mlon={restaurant["lng"]}'
            f'#map=17/{restaurant["lat"]}/{restaurant["lng"]}">Open in OpenStreetMap</a>'
        )
    socials = []
    if restaurant["instagram"]:
        socials.append(f'<a href="{e(restaurant["instagram"])}" rel="noopener noreferrer">Instagram</a>')
    if restaurant["facebook"]:
        socials.append(f'<a href="{e(restaurant["facebook"])}" rel="noopener noreferrer">Facebook</a>')
    facts = "".join(
        [
            fact("Hours", e(restaurant["hours"]) if restaurant["hours"] else "Hours not listed"),
            fact("Phone", phone),
            fact("Website", website),
            fact("Address", e(restaurant["address"])),
            fact("Directions", directions),
            fact("Food", e(", ".join(restaurant["foods"]))),
            fact("Vibe", e(", ".join(restaurant["vibes"]))),
            fact("Category", e(restaurant["category"])),
            fact("Also", " · ".join(socials)),
        ]
    )
    logo = f'<img class="logo" src="{e(restaurant["logo"])}" alt="{e(restaurant["name"])} logo">' if restaurant["logo"] else ""
    nearby = [
        other
        for other in restaurants
        if other["areaSlug"] == restaurant["areaSlug"] and other["slug"] != restaurant["slug"]
    ][:4]
    nearby_html = "".join(
        f'<a class="map-hit" href="/restaurants/{e(other["slug"])}/"><strong>{e(other["name"])}</strong><span>{e(other["price"])}</span></a>'
        for other in nearby
    )
    map_html = ""
    if restaurant["lat"] is not None and restaurant["lng"] is not None:
        map_html = (
            f'<div id="detail-map" data-lat="{restaurant["lat"]}" data-lng="{restaurant["lng"]}" '
            f'data-name="{e(restaurant["name"])}" role="region" aria-label="Map"></div>'
            '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">'
            '<script src="/vendor/leaflet/leaflet.js"></script>'
        )
    area_href = f'/restaurants/?area={restaurant["areaSlug"]}'
    body = (
        '<div class="wrap detail">'
        f'<div class="detail-hero">{media_block(restaurant["heroImage"], restaurant["name"], restaurant["tone"], shot_label(restaurant), eager=True)}</div>'
        "<div>"
        f'<p class="crumbs"><a href="/">Home</a> / <a href="/restaurants/">Restaurants</a> / {e(restaurant["name"])}</p>'
        f"<h1>{e(restaurant['name'])}</h1>"
        f'<p class="lede"><a href="{e(area_href)}">{e(restaurant["label"] or restaurant["area"])}</a>'
        + (f' · {e(restaurant["category"])}' if restaurant["category"] else "")
        + "</p>"
        f'<ul class="chips">{"".join(chips)}</ul>'
        f'<div class="prose"><p>{e(restaurant["notes"])}</p></div>'
        "</div><aside>"
        f"{logo}<dl class=\"facts\">{facts}</dl></aside>"
        f"{map_html}"
        f'<section><h2>More in {e(restaurant["area"])}</h2><div class="map-list">{nearby_html}</div>'
        f'<p><a href="{e(area_href)}">All {e(restaurant["area"])} restaurants</a></p></section>'
        "</div>"
    )
    description = snippet(restaurant["notes"], 155) or f'{restaurant["name"]} in {restaurant["area"]} on Scenic Highway 30A.'
    same_as = [url for url in (restaurant["website"], restaurant["instagram"], restaurant["facebook"]) if url]
    schema = {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        "name": restaurant["name"],
        "url": f"{ORIGIN}/restaurants/{restaurant['slug']}/",
        "description": restaurant["notes"],
        "servesCuisine": restaurant["cuisines"],
        "address": {
            "@type": "PostalAddress",
            "streetAddress": restaurant["street"] or restaurant["address"],
            "addressLocality": restaurant["area"],
            "addressRegion": "FL",
            "postalCode": restaurant["postal"],
            "addressCountry": "US",
        },
    }
    if restaurant["price"]:
        schema["priceRange"] = restaurant["price"]
    if restaurant["phone"]:
        schema["telephone"] = restaurant["phone"]
    if restaurant["lat"] is not None:
        schema["geo"] = {"@type": "GeoCoordinates", "latitude": restaurant["lat"], "longitude": restaurant["lng"]}
    if restaurant["heroImage"]:
        image = restaurant["heroImage"]
        schema["image"] = image if image.startswith("http") else ORIGIN + image
    if same_as:
        schema["sameAs"] = same_as
    extra = json_ld(schema)
    if restaurant["heroImage"]:
        image = restaurant["heroImage"]
        if not image.startswith("http"):
            image = ORIGIN + image
        extra += f'<meta property="og:image" content="{e(image)}">\n'
    write(
        ROOT / "restaurants" / restaurant["slug"] / "index.html",
        layout(
            f'{restaurant["name"]} · {restaurant["area"]} | Eating on 30A',
            description,
            f'/restaurants/{restaurant["slug"]}/',
            "restaurants",
            body,
            extra,
        ),
    )


def build_map(areas: list[dict], cuisines: list[str]) -> None:
    body = (
        '<div class="wrap page-intro"><p class="kicker">OpenStreetMap</p>'
        '<h1 id="listing-title">Sample map</h1>'
        "<p class=\"lede\">Same filters as the directory, limited to the sample. Pins sit on OpenStreetMap, so this page does not use Google Maps.</p>"
        + filter_form(areas, cuisines).replace('action="/restaurants/"', 'action="/map/"').replace('href="/restaurants/"', 'href="/map/"')
        + '<p id="result-count" class="count">Loading the map…</p>'
        '<p id="map-note" class="empty" hidden></p>'
        '<div class="map-layout"><div id="map" role="region" aria-label="Restaurant map"></div>'
        '<div id="map-list" class="map-list"></div></div></div>'
    )
    extra = (
        '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">\n'
        '<script src="/vendor/leaflet/leaflet.js"></script>\n'
    )
    write(
        ROOT / "map" / "index.html",
        layout(
            "Restaurant map along 30A | Eating on 30A",
            "Map of restaurants along Scenic Highway 30A using OpenStreetMap.",
            "/map/",
            "map",
            body,
            extra,
        ),
    )


def build_areas(areas: list[dict], restaurants: list[dict]) -> None:
    cards = []
    for area in areas:
        photo = f'<img src="{e(area["image"])}" alt="" loading="lazy">' if area["image"] else placeholder("gulf", area["name"])
        cards.append(
            f'<a class="town" href="/areas/{e(area["slug"])}/">{photo}'
            f'<span class="town-copy"><strong>{e(area["fullName"])}</strong><small>{area["count"]} places</small></span></a>'
        )
    body = (
        '<div class="wrap page-intro"><p class="kicker">West to east</p><h1>Towns along 30A</h1>'
        '<p class="lede">Short notes for each community. To filter the full directory, use the town names on the homepage or the town menu inside Restaurants.</p>'
        f'<div class="town-grid">{"".join(cards)}</div></div>'
    )
    write(
        ROOT / "areas" / "index.html",
        layout(
            "Towns along 30A | Eating on 30A",
            "Restaurant towns along Scenic Highway 30A, from Dune Allen to Inlet Beach.",
            "/areas/",
            "areas",
            body,
        ),
    )
    for area in areas:
        group = [restaurant for restaurant in restaurants if restaurant["areaSlug"] == area["slug"]]
        video = ""
        if "watch?v=" in area["video"] or "youtu.be/" in area["video"]:
            video = f'<p><a href="{e(area["video"])}">Watch a short clip of {e(area["name"])}</a></p>'
        photo = ""
        if area["image"]:
            photo = f'<img src="{e(area["image"])}" alt="{e(area["fullName"])}" loading="eager">'
        body = (
            '<div class="wrap page-intro">'
            f'<p class="crumbs"><a href="/areas/">Towns</a> / {e(area["fullName"])}</p>'
            f'<div class="detail-hero">{photo or placeholder("gulf", area["name"])}</div>'
            f"<h1>{e(area['fullName'])}</h1>"
            f'<p class="lede">{e(area["description"])}</p>'
            f'<p><a class="button" href="/restaurants/?area={e(area["slug"])}">Show {area["count"]} in the directory</a> '
            f'<a class="button secondary" href="/map/?area={e(area["slug"])}">Map this town</a></p>'
            f"{video}"
            f'<div class="card-grid">{"".join(card(restaurant, "h2") for restaurant in group)}</div>'
            "</div>"
        )
        write(
            ROOT / "areas" / area["slug"] / "index.html",
            layout(
                f'{area["fullName"]} restaurants | Eating on 30A',
                snippet(area["description"], 155) or f'Restaurants in {area["fullName"]} on Scenic Highway 30A.',
                f'/areas/{area["slug"]}/',
                "areas",
                body,
                json_ld(
                    {
                        "@context": "https://schema.org",
                        "@type": "CollectionPage",
                        "name": f'{area["fullName"]} restaurants',
                        "url": f'{ORIGIN}/areas/{area["slug"]}/',
                        "description": area["description"],
                    }
                ),
            ),
        )


def build_about() -> None:
    body = (
        '<div class="wrap page-intro prose"><p class="kicker">About</p>'
        "<h1>The 30A restaurant guide</h1>"
        f"<p>{e(ABOUT)}</p>"
        "<p>Start with breakfast, lunch, or dinner on the homepage, or pick a town. Those links open the directory with the filter already applied. The map uses the same filters and OpenStreetMap tiles.</p>"
        "<p>What you see now is a design shell: a handful of real listings so the pages are not empty. The full export stays in <code>data/restaurants.csv</code> and is published only after this look is approved.</p>"
        "<p>Listings come from the project’s CSV files, not from a live Google Places lookup. If a restaurant has a working photo URL in the data, the card shows it. Otherwise the card keeps a simple color block.</p>"
        '<p><a class="button" href="/restaurants/">Open the directory</a></p></div>'
    )
    write(
        ROOT / "about" / "index.html",
        layout(
            "About | Eating on 30A",
            "How the Eating on 30A restaurant guide is organized along Scenic Highway 30A.",
            "/about/",
            "about",
            body,
            include_js=False,
        ),
    )


def build_contact() -> None:
    body = (
        '<div class="wrap page-intro prose"><p class="kicker">Contact</p>'
        "<h1>Corrections and new listings</h1>"
        "<p>Hours, phone numbers, and websites live on each restaurant page. For a correction to this guide, edit the CSV that feeds the site and rebuild. The README in the project explains the columns.</p>"
        '<p>The source files are <code>data/restaurants.csv</code> and <code>data/locations.csv</code>. '
        "This preview does not attach a custom domain and does not send the old Wix coupon form anywhere.</p>"
        '<p><a href="https://github.com/marcongit850/eatingon30A">eatingon30A on GitHub</a></p></div>'
    )
    write(
        ROOT / "contact" / "index.html",
        layout(
            "Contact | Eating on 30A",
            "How to correct a restaurant listing in the Eating on 30A guide.",
            "/contact/",
            "",
            body,
            include_js=False,
        ),
    )


def build_404() -> None:
    body = (
        '<div class="wrap page-intro prose"><h1>That page is not on the menu.</h1>'
        '<p>Try the restaurant directory or the map.</p>'
        '<p><a class="button" href="/restaurants/">Browse restaurants</a></p></div>'
    )
    write(ROOT / "404.html", layout("Page not found | Eating on 30A", "That page is not on the Eating on 30A guide.", "/404.html", "", body, include_js=False))


def build_sitemap(restaurants: list[dict], areas: list[dict]) -> None:
    urls = [
        ("/", ""),
        ("/restaurants/", ""),
        ("/map/", ""),
        ("/areas/", ""),
        ("/about/", ""),
        ("/contact/", ""),
    ]
    for area in areas:
        urls.append((f"/areas/{area['slug']}/", ""))
    for restaurant in restaurants:
        urls.append((f"/restaurants/{restaurant['slug']}/", restaurant["updated"]))
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for path, updated in urls:
        lines.append("  <url>")
        lines.append(f"    <loc>{e(ORIGIN + path)}</loc>")
        if updated:
            lines.append(f"    <lastmod>{e(updated)}</lastmod>")
        lines.append("  </url>")
    lines.append("</urlset>")
    write(ROOT / "sitemap.xml", "\n".join(lines) + "\n")


def build_robots() -> None:
    agents = [
        "*",
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
    ]
    blocks = [f"User-agent: {agent}\nAllow: /\n" for agent in agents]
    text = "\n".join(blocks) + f"\nSitemap: {ORIGIN}/sitemap.xml\n"
    write(ROOT / "robots.txt", text)


def build_llms(restaurants: list[dict], areas: list[dict]) -> None:
    lines = [
        "# Eating on 30A",
        "",
        "> Restaurant guide for Scenic Highway 30A in Walton County, Florida.",
        "",
        ABOUT,
        "",
        "Listings are edited in CSV files in the GitHub repository. The public preview does not use a custom domain.",
        "",
        f"- [Home]({ORIGIN}/)",
        f"- [Restaurants]({ORIGIN}/restaurants/)",
        f"- [Map]({ORIGIN}/map/)",
        f"- [Towns]({ORIGIN}/areas/)",
        f"- [About]({ORIGIN}/about/)",
        "",
        "## Towns",
        "",
    ]
    for area in areas:
        lines.append(f"- [{area['fullName']}]({ORIGIN}/areas/{area['slug']}/): {area['description']}")
    write(ROOT / "llms.txt", "\n".join(lines) + "\n")
    full = lines + ["", "## Restaurants", ""]
    for restaurant in restaurants:
        bits = ", ".join(restaurant["cuisines"]) or restaurant["category"] or "Restaurant"
        meals = ", ".join(restaurant["meals"])
        full.append(
            f"- [{restaurant['name']}]({ORIGIN}/restaurants/{restaurant['slug']}/) — {restaurant['area']}; {bits}; {meals}. {snippet(restaurant['notes'], 180)}"
        )
    write(ROOT / "llms-full.txt", "\n".join(full) + "\n")


def main() -> None:
    restaurants = published_restaurants()
    areas = load_areas(restaurants)
    hero = hero_image()
    cuisines = sorted({cuisine for restaurant in restaurants for cuisine in restaurant["cuisines"]})
    shutil.rmtree(ROOT / "restaurants", ignore_errors=True)
    shutil.rmtree(ROOT / "areas", ignore_errors=True)
    write(DATA / "restaurants.json", json.dumps([public_record(item) for item in restaurants], indent=2) + "\n")
    write(
        DATA / "locations.json",
        json.dumps(
            [
                {
                    "slug": area["slug"],
                    "name": area["fullName"],
                    "shortName": area["name"],
                    "description": area["description"],
                    "count": area["count"],
                    "image": area["image"],
                }
                for area in areas
            ],
            indent=2,
        )
        + "\n",
    )
    build_home(restaurants, areas, hero)
    build_directory(restaurants, areas, cuisines)
    for restaurant in restaurants:
        build_detail(restaurant, restaurants)
    build_map(areas, cuisines)
    build_areas(areas, restaurants)
    build_about()
    build_contact()
    build_404()
    build_sitemap(restaurants, areas)
    build_robots()
    build_llms(restaurants, areas)
    photos = sum(1 for restaurant in restaurants if restaurant["cardImage"])
    print(f"Built {len(restaurants)} restaurants, {len(areas)} towns, {photos} photos")


if __name__ == "__main__":
    main()
