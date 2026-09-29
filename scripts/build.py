#!/usr/bin/env python3
"""Build the Eating on 30A static site from data/*.csv.

Edit the CSVs, then run: python3 scripts/build.py
"""

from __future__ import annotations

import csv
import html
import json
import os
import re
import shutil
import unicodedata
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG = json.loads((ROOT / "site.config.json").read_text(encoding="utf-8"))
ORIGIN = os.environ.get("SITE_ORIGIN", CONFIG["origin"]).rstrip("/")
SHARE_IMAGE = "/images/og-scenic-30a.jpg"
SHARE_ALT = "Gulf water and white sand along Scenic Highway 30A in Walton County, Florida."

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

# None publishes every PUBLISHED row in data/restaurants.csv.
# Set this to a list of slugs only when a design sample is needed again.
SAMPLE_SLUGS = None

# The Wix export's detail photo for Stinky's is a multi-megabyte PNG.
# The cover now comes from the supplied photo set. The logo stays a local file.
LOCAL_WIX_FILES = {
    "de29ed_1a5c50c91a154838816cc7ea7b48a6c6~mv2.png": "/images/restaurants/stinkys-fish-camp-dune-allen-beach/01.jpg",
    "de29ed_29920b8a7db54505a77b6a647ed4a343~mv2.jpg": "/images/restaurants/stinkys-fish-camp-logo.jpg",
}

PHOTO_DIR = ROOT / "images" / "restaurants"
PHOTO_EXTS = (".jpg", ".jpeg", ".webp", ".png")

ABOUT = (
    "Eating on 30A is a restaurant guide for Scenic Highway 30A in South Walton. "
    "Find breakfast, lunch, and dinner from Dune Allen to Inlet Beach, "
    "with the address, the hours, and a feel for the place."
)
TOWNS = (
    "The towns along the highway are Dune Allen, Gulf Place, Blue Mountain, Grayton Beach, "
    "WaterColor, Seaside, Seagrove, Seacrest, Watersound, Alys Beach, Rosemary Beach, "
    "Inlet Beach, and Watersound Origins."
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
    empty = {"formatted": "", "lat": None, "lng": None, "postal": "", "street": "", "region": "FL", "city": ""}
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
        "city": clean_text(data.get("city") or ""),
    }


PHOTO_FRAMES = ("01", "02", "03", "04", "05")


def local_listing_photo(slug: str) -> str | None:
    """Use images/restaurants/<slug>.<ext> when someone drops a single cover in that folder."""
    for ext in PHOTO_EXTS:
        if (PHOTO_DIR / f"{slug}{ext}").is_file():
            return f"/images/restaurants/{slug}{ext}"
    return None


def listing_photos(slug: str) -> list[str]:
    """Photos for one listing. 01 is the cover; later frames are extras on the profile."""
    folder = PHOTO_DIR / slug
    found: list[str] = []
    if folder.is_dir():
        for stem in PHOTO_FRAMES:
            for ext in PHOTO_EXTS:
                if (folder / f"{stem}{ext}").is_file():
                    found.append(f"/images/restaurants/{slug}/{stem}{ext}")
                    break
    if found:
        return found
    single = local_listing_photo(slug)
    return [single] if single else []


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
        photos = listing_photos(slug)
        dropped = photos[0] if photos else None
        card_image = dropped or list_image or detail_image
        hero_image = dropped or detail_image or list_image
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
                "city": address["city"],
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
                "photos": photos,
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


MONOGRAM_SKIP = {"the", "and", "at", "of", "a", "an", "by", "for", "on", "in"}


def shot_label(restaurant: dict) -> str:
    if restaurant["foods"]:
        return restaurant["foods"][0]
    if restaurant["cuisines"]:
        return restaurant["cuisines"][0]
    return restaurant["area"]


def monogram(name: str) -> str:
    cleaned = (name or "").replace("’", "").replace("'", "").replace("&", " ")
    words = [word for word in re.findall(r"[A-Za-z0-9]+", cleaned) if word.lower() not in MONOGRAM_SKIP]
    if not words:
        words = re.findall(r"[A-Za-z0-9]+", name or "") or ["E"]
    return "".join(word[0] for word in words[:2]).upper()


def placeholder(tone: str, label: str, name: str = "", hidden: bool = False) -> str:
    mark = monogram(name or label)
    flag = " hidden" if hidden else ""
    return (
        f'<div class="ph" data-tone="{e(tone)}"{flag}>'
        f'<span class="mono" aria-hidden="true">{e(mark)}</span>'
        f'<span class="ph-label">{e(label)}</span></div>'
    )


def filmstrip(restaurant: dict) -> str:
    extras = (restaurant.get("photos") or [])[1:]
    if not extras:
        return ""
    frames = "".join(
        f'<img src="{e(src)}" alt="{e(photo_alt(restaurant))}" loading="lazy">'
        for src in extras
    )
    return f'<div class="profile-film" data-count="{len(extras)}">{frames}</div>'


def media_block(image: str | None, alt: str, tone: str, label: str, eager: bool = False, name: str = "") -> str:
    mark_name = name or alt
    if not image:
        return placeholder(tone, label, mark_name)
    loading = "eager" if eager else "lazy"
    return (
        f'<img src="{e(image)}" alt="{e(alt)}" loading="{loading}" '
        'onerror="var p=this.parentElement;this.remove();var f=p&&p.querySelector(\'.ph\');if(f)f.hidden=false">'
        f"{placeholder(tone, label, mark_name, hidden=True)}"
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
        f'<div class="card-media">{media_block(restaurant["cardImage"], photo_alt(restaurant), restaurant["tone"], label, name=restaurant["name"])}</div>'
        f'<div class="card-body"><p class="card-area">{e(area_line)}</p>'
        f'<{heading}>{e(restaurant["name"])}</{heading}>'
        f'<p class="meta">{e(" · ".join(bits))}</p>{note_html}</div></a>'
    )


def photo_alt(restaurant: dict) -> str:
    return f"{restaurant['name']} in {restaurant['area']} on Scenic Highway 30A"


def fit_meta(lead: str, identity: str) -> str:
    """Build a unique description in the same length range as the other 30A sites."""
    lead = clean_text(lead).rstrip(".")
    identity = clean_text(identity)
    text = f"{lead}. {identity}" if lead else identity
    if len(text) > 165:
        room = 165 - len(identity) - 2
        cut = lead[:room].rsplit(" ", 1)[0].rstrip(".,;:") if room > 24 else ""
        text = f"{cut}. {identity}" if cut else identity
    if len(text) < 110:
        text = f"{text} Hours, address, and map are on the profile."
    if len(text) > 165:
        text = text[:165].rsplit(" ", 1)[0].rstrip(".,;:")
    return text


def listing_description(restaurant: dict) -> str:
    identity = f"{restaurant['name']} in {restaurant['area']} on Scenic Highway 30A, Walton County, Florida."
    return fit_meta(restaurant["notes"], identity)


def local_image_info(path: Path) -> tuple[int, int, str] | None:
    if not path.is_file():
        return None
    data = path.read_bytes()
    if data.startswith(b"\x89PNG") and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big"), "image/png"
    if data[:2] != b"\xff\xd8":
        return None
    index = 2
    while index < len(data) - 8:
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            height = int.from_bytes(data[index + 5 : index + 7], "big")
            width = int.from_bytes(data[index + 7 : index + 9], "big")
            return width, height, "image/jpeg"
        if marker in (0xD8, 0xD9):
            index += 2
            continue
        if index + 4 > len(data):
            break
        length = int.from_bytes(data[index + 2 : index + 4], "big")
        if length < 2:
            break
        index += 2 + length
    return None


def image_facts(url: str | None) -> dict:
    src = url or SHARE_IMAGE
    absolute = src if src.startswith(("http://", "https://")) else ORIGIN + src
    facts = {"url": absolute}
    info = None
    if src.startswith("/"):
        info = local_image_info(ROOT / src.lstrip("/"))
    else:
        match = re.search(r"w_(\d+),h_(\d+)", src)
        if match:
            kind = "image/png" if ".png" in src.lower() else "image/jpeg"
            info = (int(match.group(1)), int(match.group(2)), kind)
    if info:
        facts["width"], facts["height"], facts["type"] = info
    return facts


def social_tags(title: str, description: str, canonical: str, image: str | None, image_alt: str) -> str:
    facts = image_facts(image)
    alt = image_alt or SHARE_ALT
    tags = [
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(description)}">',
        f'<meta property="og:url" content="{e(canonical)}">',
        f'<meta property="og:image" content="{e(facts["url"])}">',
        f'<meta property="og:image:alt" content="{e(alt)}">',
    ]
    if "width" in facts:
        tags.append(f'<meta property="og:image:width" content="{facts["width"]}">')
        tags.append(f'<meta property="og:image:height" content="{facts["height"]}">')
        tags.append(f'<meta property="og:image:type" content="{facts["type"]}">')
    tags.extend(
        [
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="Eating on 30A">',
            '<meta property="og:locale" content="en_US">',
            '<meta name="twitter:card" content="summary_large_image">',
            f'<meta name="twitter:title" content="{e(title)}">',
            f'<meta name="twitter:description" content="{e(description)}">',
            f'<meta name="twitter:image" content="{e(facts["url"])}">',
            f'<meta name="twitter:image:alt" content="{e(alt)}">',
        ]
    )
    return "\n".join(tags) + "\n"


def breadcrumbs(crumbs: list[tuple[str, str]]) -> dict:
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": index, "name": name, "item": ORIGIN + path}
            for index, (name, path) in enumerate(crumbs, start=1)
        ],
    }


def graph(*nodes: dict) -> dict:
    return {"@context": "https://schema.org", "@graph": list(nodes)}


def layout(
    title: str,
    description: str,
    path: str,
    active: str,
    body: str,
    extra_head: str = "",
    include_js: bool = True,
    image: str | None = None,
    image_alt: str = "",
    noindex: bool = False,
) -> str:
    canonical = ORIGIN + path
    scripts = '<script src="/header.js"></script>\n<script src="/footer.js"></script>\n'
    if include_js:
        scripts += '<script type="module" src="/site.js"></script>'
    body_attr = ' class="home"' if active == "home" else ""
    banner = "" if active == "home" else sample_banner()
    robots = '<meta name="robots" content="noindex">\n' if noindex else ""
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{e(title)}</title>\n"
        f'<meta name="description" content="{e(description)}">\n'
        f'<link rel="canonical" href="{e(canonical)}">\n'
        + robots
        + social_tags(title, description, canonical, image, image_alt)
        + '<meta name="theme-color" content="#102825">\n'
        '<link rel="icon" href="/favicon.ico" sizes="any">\n'
        '<link rel="icon" href="/favicon.png" type="image/png" sizes="32x32">\n'
        '<link rel="icon" href="/images/eating-favicon-512.png" type="image/png" sizes="512x512">\n'
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Outfit:wght@300;400;500&display=swap" rel="stylesheet">\n'
        '<link rel="stylesheet" href="/styles.css">\n'
        + extra_head
        + f"</head>\n<body{body_attr}>\n"
        + '<div id="site-header"></div>\n'
        + banner
        + '<main id="main">\n'
        + body
        + "</main>\n"
        + '<div id="site-footer"></div>\n'
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
        '<label class="field"><span>Search</span><input id="q" name="q" type="search" placeholder="Oysters, coffee, pizza"></label>'
        f'<label class="field"><span>Town</span><select id="area" name="area">{"".join(area_options)}</select></label>'
        f'<label class="field"><span>Meal</span><select id="meal" name="meal">{"".join(meal_options)}</select></label>'
        f'<label class="field"><span>Cuisine</span><select id="cuisine" name="cuisine">{"".join(cuisine_options)}</select></label>'
        '<div class="checks">'
        '<label class="check"><input type="checkbox" name="outdoor" value="yes"><span>Outdoor dining</span></label>'
        '<label class="check"><input type="checkbox" name="kids" value="yes"><span>Kid friendly</span></label>'
        '<label class="check"><input type="checkbox" name="music" value="yes"><span>Live music</span></label>'
        "</div>"
        '<div class="filter-actions"><button type="submit">Apply</button><a class="clear" href="/restaurants/">Clear</a></div>'
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


def select_featured(restaurants: list[dict]) -> list[dict]:
    """Homepage cover order. Slugs live in site.config.json so a paid spot is a config edit."""
    by_slug = {item["slug"]: item for item in restaurants}
    slugs = CONFIG.get("featured") or []
    if not isinstance(slugs, list) or not slugs:
        fallback = next((item for item in restaurants if item["heroImage"] or item["cardImage"]), None)
        return [fallback] if fallback else []
    missing = [str(slug) for slug in slugs if str(slug) not in by_slug]
    if missing:
        raise SystemExit("featured slugs are not published listings: " + ", ".join(missing))
    if len(slugs) != len(set(slugs)):
        raise SystemExit("featured slugs must be unique")
    return [by_slug[str(slug)] for slug in slugs]


def cover_slot(feature: dict, hidden: bool, eager: bool) -> str:
    image = feature["heroImage"] or feature["cardImage"]
    meta = " · ".join(
        bit for bit in (feature["label"] or feature["area"], feature["price"], ", ".join(feature["cuisines"])) if bit
    )
    flag = " hidden" if hidden else ""
    return (
        f'<div class="cover" data-featured{flag}>'
        f'<a class="cover-media" href="/restaurants/{e(feature["slug"])}/">'
        f'{media_block(image, photo_alt(feature), feature["tone"], shot_label(feature), eager=eager, name=feature["name"])}'
        "</a><div class=\"cover-copy\">"
        '<p class="kicker">From the guide</p>'
        f"<h2>{e(feature['name'])}</h2>"
        f'<p class="lede">{e(snippet(feature["notes"], 240))}</p>'
        f'<p class="meta">{e(meta)}</p>'
        f'<p><a class="text-link" href="/restaurants/{e(feature["slug"])}/">Read the profile</a></p>'
        "</div></div>"
    )


def featured_controls() -> str:
    """Prev/next sit on the photo. They stay hidden until the page script binds them."""
    left = (
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        '<path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" '
        'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
    )
    right = (
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        '<path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" '
        'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
    )
    return (
        '<div class="cover-controls" hidden>'
        f'<button type="button" class="cover-arrow" data-featured-step="-1" aria-label="Previous featured">{left}</button>'
        f'<button type="button" class="cover-arrow" data-featured-step="1" aria-label="Next featured">{right}</button>'
        '<p class="sr-only" data-featured-status aria-live="polite"></p>'
        "</div>"
    )


def restaurant_count_word(count: int, label: bool = False) -> str:
    """Visitor noun for a restaurant count.

    Badges and other noun labels use a capital R ("7 Restaurants").
    Counts inside a sentence stay lowercase ("7 restaurants"), the same
    way the directory result line is written.
    """
    if count == 1:
        return "Restaurant" if label else "restaurant"
    return "Restaurants" if label else "restaurants"


FEATURED_ROTATION = (
    "<script>!function(){var nodes=document.querySelectorAll('#from-the-guide [data-featured]');"
    "if(nodes.length<2)return;var index=Math.floor(Date.now()/86400000)%nodes.length;"
    "for(var i=0;i<nodes.length;i++)nodes[i].hidden=i!==index;}();</script>"
)


def build_home(restaurants: list[dict], areas: list[dict], hero: str | None) -> None:
    meal_counts = []
    for meal in MEAL_ORDER:
        count = sum(1 for restaurant in restaurants if meal in restaurant["meals"])
        if count:
            meal_counts.append((meal, count))
    meals_html = "".join(
        f'<a href="/restaurants/?meal={e(meal)}"><span>{e(meal)}</span><em>{count:02d}</em></a>'
        for meal, count in meal_counts
    )
    towns = []
    for area in areas:
        if area["image"]:
            photo = f'<img src="{e(area["image"])}" alt="{e(area["fullName"] + " on Scenic Highway 30A")}" loading="lazy">'
        else:
            photo = placeholder("gulf", area["name"], area["name"])
        word = restaurant_count_word(area["count"], label=True)
        towns.append(
            f'<a class="town" href="/restaurants/?area={e(area["slug"])}">'
            f'<span class="town-frame">{photo}</span>'
            f'<span class="town-copy"><strong>{e(area["name"])}</strong><small>{area["count"]} {word}</small></span>'
            "</a>"
        )
    featured = select_featured(restaurants)
    slots = "".join(
        cover_slot(feature, hidden=index != 0, eager=index == 0)
        for index, feature in enumerate(featured)
    )
    cover = ""
    if slots:
        controls = featured_controls() if len(featured) > 1 else ""
        cover = (
            '<section class="section cover-section" id="from-the-guide" aria-label="From the guide">'
            '<div class="wrap cover-stage">'
            f"{controls}{slots}</div>{FEATURED_ROTATION}</section>"
        )
    hero_html = (
        f'<img class="hero-photo" src="{e(hero)}" alt="{e(SHARE_ALT)}" width="1800" height="1200">'
        if hero
        else ""
    )
    body = (
        '<section class="hero">'
        f"{hero_html}"
        '<div class="hero-veil" aria-hidden="true"></div>'
        '<div class="hero-copy"><div class="wrap">'
        '<p class="issue-line">A restaurant guide for the Emerald Coast.</p>'
        '<p class="eyebrow">Scenic Highway 30A · South Walton</p>'
        "<h1>Where to eat<br> on 30A.</h1>"
        '<p class="lede">Find breakfast, lunch, and dinner along Scenic Highway 30A — from Dune Allen to Inlet Beach.</p>'
        '<form class="search-form" action="/restaurants/" method="get">'
        '<label class="field"><span class="sr-only">Search restaurants</span>'
        '<input name="q" type="search" placeholder="Oysters, coffee, a town…"></label>'
        "<button>Search</button></form>"
        "</div></div></section>"
        f'<nav class="meal-index" aria-label="Meals">{meals_html}</nav>'
        f"{cover}"
        '<section class="section band"><div class="wrap">'
        '<div class="section-head"><div><p class="kicker">West to east</p><h2>The towns</h2></div>'
        "<p>Each town opens the directory with that stretch of 30A already selected.</p></div>"
        f'<div class="town-grid">{"".join(towns)}</div>'
        '<p class="section-links"><a class="text-link" href="/areas/">Town notes</a><a class="text-link" href="/map/">The map</a></p>'
        "</div></section>"
        '<section class="section"><div class="wrap essay-grid">'
        '<div><p class="kicker">The corridor</p><h2>A guide for the whole coast.</h2></div>'
        f'<div class="prose"><p>{e(ABOUT)}</p>'
        '<p><a class="button" href="/restaurants/">Browse the directory</a></p></div>'
        "</div></section>"
    )
    description = "Find restaurants along Scenic Highway 30A in Walton County, Florida, by meal, town, or cuisine, with a directory and a map."
    extra = json_ld(
        graph(
            {
                "@type": "Organization",
                "@id": ORIGIN + "/#organization",
                "name": "Eating on 30A",
                "url": ORIGIN + "/",
                "description": ABOUT,
            },
            {
                "@type": "WebSite",
                "@id": ORIGIN + "/#website",
                "name": "Eating on 30A",
                "url": ORIGIN + "/",
                "description": description,
                "inLanguage": "en",
                "publisher": {"@id": ORIGIN + "/#organization"},
                "potentialAction": {
                    "@type": "SearchAction",
                    "target": ORIGIN + "/restaurants/?q={search_term_string}",
                    "query-input": "required name=search_term_string",
                },
            },
            {
                "@type": "ItemList",
                "name": "Towns along 30A",
                "numberOfItems": len(areas),
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": index,
                        "name": area["fullName"],
                        "url": f"{ORIGIN}/areas/{area['slug']}/",
                    }
                    for index, area in enumerate(areas, start=1)
                ],
            },
        )
    )
    write(
        ROOT / "index.html",
        layout(
            "Eating on 30A | Restaurant guide for Scenic Highway 30A",
            description,
            "/",
            "home",
            body,
            extra,
            image=hero,
            image_alt=SHARE_ALT,
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
        '<h1 id="listing-title">The table</h1>'
        "<p class=\"lede\">Narrow the guide by town, meal, or a few words. Homepage shortcuts land here with the matching filter already on.</p>"
        f"{filter_form(areas, cuisines)}"
        f'<p id="result-count" class="count" aria-live="polite">{len(restaurants)} restaurants</p>'
        f'<p id="empty" class="empty" hidden>No restaurants match. <a href="/restaurants/">Clear the filters</a>.</p>'
        f'<div id="cards" class="card-grid">{cards}</div></div>'
    )
    extra = pending + json_ld(
        graph(
            {
                "@type": "CollectionPage",
                "@id": ORIGIN + "/restaurants/#page",
                "name": "Restaurants along 30A",
                "url": ORIGIN + "/restaurants/",
                "isPartOf": {"@id": ORIGIN + "/#website"},
                "description": "Search restaurants on Scenic Highway 30A in Walton County, Florida, by town, meal, and cuisine. All 114 listings are here.",
            },
            {
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
            },
            breadcrumbs([("Home", "/"), ("Restaurants", "/restaurants/")]),
        )
    )
    write(
        ROOT / "restaurants" / "index.html",
        layout(
            "Restaurants along 30A | Eating on 30A",
            "Search restaurants on Scenic Highway 30A in Walton County, Florida, by town, meal, and cuisine. All 114 listings are here.",
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
    """Single restaurant profile template. Every listing page is rendered here."""
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
    website = ""
    if restaurant["website"]:
        host = re.sub(r"^www\.", "", re.sub(r"^https?://", "", restaurant["website"]).split("/")[0])
        website = f'<a href="{e(restaurant["website"])}" rel="noopener noreferrer">{e(host)}</a>'
    directions = ""
    if restaurant["lat"] is not None and restaurant["lng"] is not None:
        directions = (
            f'<a href="https://www.openstreetmap.org/?mlat={restaurant["lat"]}&amp;mlon={restaurant["lng"]}'
            f'#map=17/{restaurant["lat"]}/{restaurant["lng"]}">View map</a>'
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
            f'data-name="{e(restaurant["name"])}" data-slug="{e(restaurant["slug"])}" '
            f'data-area="{e(restaurant["area"])}" data-address="{e(restaurant["address"])}" '
            f'data-image="{e(restaurant["heroImage"] or "")}" role="region" aria-label="Map"></div>'
            '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">'
            '<script src="/vendor/leaflet/leaflet.js"></script>'
        )
    area_href = f'/restaurants/?area={restaurant["areaSlug"]}'
    area_line = restaurant["label"] or restaurant["area"]
    price_bit = f' · {e(restaurant["price"])}' if restaurant["price"] else ""
    category_bit = f' · {e(restaurant["category"])}' if restaurant["category"] else ""
    map_block = f'<div class="wrap profile-map">{map_html}</div>' if map_html else ""
    if nearby_html:
        more = (
            f'<section class="wrap more"><h2>Also in {e(restaurant["area"])}</h2>'
            f'<div class="map-list">{nearby_html}</div>'
            f'<p><a class="text-link" href="{e(area_href)}">All of {e(restaurant["area"])}</a></p></section>'
        )
    else:
        more = (
            f'<section class="wrap more"><p><a class="text-link" href="{e(area_href)}">{e(restaurant["area"])} in the guide</a></p></section>'
        )
    body = (
        '<article class="profile">'
        f'<div class="profile-hero">{media_block(restaurant["heroImage"], photo_alt(restaurant), restaurant["tone"], shot_label(restaurant), eager=True, name=restaurant["name"])}</div>'
        f"{filmstrip(restaurant)}"
        '<div class="wrap profile-head">'
        f'<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/restaurants/">Restaurants</a> <span aria-hidden="true">/</span> {e(restaurant["name"])}</p>'
        f'<p class="eyebrow"><a href="{e(area_href)}">{e(area_line)}</a>{price_bit}{category_bit}</p>'
        f"<h1>{e(restaurant['name'])}</h1>"
        f'<ul class="chips">{"".join(chips)}</ul>'
        "</div>"
        '<div class="wrap profile-grid">'
        f'<div class="prose profile-story"><p>{e(restaurant["notes"])}</p></div>'
        f"<aside>{logo}<dl class=\"facts\">{facts}</dl></aside>"
        "</div>"
        f"{map_block}{more}"
        "</article>"
    )
    description = listing_description(restaurant)
    page_url = f"{ORIGIN}/restaurants/{restaurant['slug']}/"
    same_as = [url for url in (restaurant["website"], restaurant["instagram"], restaurant["facebook"]) if url]
    schema = {
        "@type": "Restaurant",
        "@id": page_url + "#restaurant",
        "name": restaurant["name"],
        "url": page_url,
        "description": restaurant["notes"] or description,
        "servesCuisine": restaurant["cuisines"],
        "address": {
            "@type": "PostalAddress",
            "streetAddress": restaurant["street"] or restaurant["address"],
            "addressLocality": restaurant["city"] or restaurant["area"],
            "addressRegion": restaurant["region"] or "FL",
            "postalCode": restaurant["postal"],
            "addressCountry": "US",
        },
        "isPartOf": {"@id": ORIGIN + "/#website"},
    }
    if restaurant["price"]:
        schema["priceRange"] = restaurant["price"]
    if restaurant["phone"]:
        schema["telephone"] = restaurant["phone"]
    if restaurant["lat"] is not None:
        schema["geo"] = {"@type": "GeoCoordinates", "latitude": restaurant["lat"], "longitude": restaurant["lng"]}
    if restaurant["heroImage"]:
        image = restaurant["heroImage"]
        schema["image"] = image if image.startswith(("http://", "https://")) else ORIGIN + image
    if same_as:
        schema["sameAs"] = same_as
    extra = json_ld(
        graph(
            schema,
            breadcrumbs(
                [
                    ("Home", "/"),
                    ("Restaurants", "/restaurants/"),
                    (restaurant["name"], f"/restaurants/{restaurant['slug']}/"),
                ]
            ),
        )
    )
    title = f'{restaurant["name"]} · {restaurant["area"]} | Eating on 30A'
    if len(title) > 70:
        title = f'{restaurant["name"]} | Eating on 30A'
    write(
        ROOT / "restaurants" / restaurant["slug"] / "index.html",
        layout(
            title,
            description,
            f'/restaurants/{restaurant["slug"]}/',
            "restaurants",
            body,
            extra,
            image=restaurant["heroImage"],
            image_alt=photo_alt(restaurant) if restaurant["heroImage"] else SHARE_ALT,
        ),
    )


def build_map(areas: list[dict], cuisines: list[str]) -> None:
    body = (
        '<div class="wrap page-intro"><p class="kicker">The map</p>'
        '<h1 id="listing-title">Along the coast</h1>'
        "<p class=\"lede\">The same filters as the directory. Each pin uses the address and coordinates stored with that restaurant. Open a pin for the name, the street address, and the profile.</p>"
        + filter_form(areas, cuisines).replace('action="/restaurants/"', 'action="/map/"').replace('href="/restaurants/"', 'href="/map/"')
        + '<p id="result-count" class="count">Loading the map…</p>'
        '<p id="map-note" class="empty" hidden></p>'
        '<div class="map-layout"><div id="map" role="region" aria-label="Restaurant map"></div>'
        '<div id="map-list" class="map-list"></div></div></div>'
    )
    extra = (
        '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">\n'
        '<script src="/vendor/leaflet/leaflet.js"></script>\n'
        + json_ld(
            graph(
                {
                    "@type": "WebPage",
                    "@id": ORIGIN + "/map/#page",
                    "name": "Restaurant map along 30A",
                    "url": ORIGIN + "/map/",
                    "isPartOf": {"@id": ORIGIN + "/#website"},
                    "description": "Map of restaurants along Scenic Highway 30A in Walton County, Florida.",
                },
                breadcrumbs([("Home", "/"), ("Map", "/map/")]),
            )
        )
    )
    write(
        ROOT / "map" / "index.html",
        layout(
            "Restaurant map along 30A | Eating on 30A",
            "Map of restaurants along Scenic Highway 30A in Walton County, Florida, using each listing’s address on OpenStreetMap.",
            "/map/",
            "map",
            body,
            extra,
        ),
    )


def build_areas(areas: list[dict], restaurants: list[dict]) -> None:
    cards = []
    for area in areas:
        photo = (
            f'<img src="{e(area["image"])}" alt="{e(area["fullName"] + " on Scenic Highway 30A")}" loading="lazy">'
            if area["image"]
            else placeholder("gulf", area["name"], area["name"])
        )
        word = restaurant_count_word(area["count"], label=True)
        cards.append(
            f'<a class="town" href="/areas/{e(area["slug"])}/"><span class="town-frame">{photo}</span>'
            f'<span class="town-copy"><strong>{e(area["fullName"])}</strong><small>{area["count"]} {word}</small></span></a>'
        )
    body = (
        '<div class="wrap page-intro"><p class="kicker">West to east</p><h1>Towns along the highway</h1>'
        '<p class="lede">They run from Dune Allen to Inlet Beach. Open a town for the restaurants there.</p>'
        f'<div class="town-grid">{"".join(cards)}</div></div>'
    )
    write(
        ROOT / "areas" / "index.html",
        layout(
            "Towns along 30A | Eating on 30A",
            "Restaurant towns along Scenic Highway 30A in Walton County, Florida, from Dune Allen Beach east to Inlet Beach.",
            "/areas/",
            "areas",
            body,
            json_ld(
                graph(
                    {
                        "@type": "CollectionPage",
                        "name": "Towns along 30A",
                        "url": ORIGIN + "/areas/",
                        "isPartOf": {"@id": ORIGIN + "/#website"},
                    },
                    {
                        "@type": "ItemList",
                        "name": "Towns along 30A",
                        "numberOfItems": len(areas),
                        "itemListElement": [
                            {
                                "@type": "ListItem",
                                "position": index,
                                "name": area["fullName"],
                                "url": f"{ORIGIN}/areas/{area['slug']}/",
                            }
                            for index, area in enumerate(areas, start=1)
                        ],
                    },
                    breadcrumbs([("Home", "/"), ("Towns", "/areas/")]),
                )
            ),
        ),
    )
    for area in areas:
        group = [restaurant for restaurant in restaurants if restaurant["areaSlug"] == area["slug"]]
        photo = ""
        if area["image"]:
            photo = f'<img src="{e(area["image"])}" alt="{e(area["fullName"])}" loading="eager">'
        body = (
            '<article class="profile">'
            f'<div class="profile-hero">{photo or placeholder("gulf", area["name"], area["name"])}</div>'
            '<div class="wrap page-intro">'
            f'<p class="crumbs"><a href="/areas/">Towns</a> <span aria-hidden="true">/</span> {e(area["fullName"])}</p>'
            f"<h1>{e(area['fullName'])}</h1>"
            f'<p class="lede">{e(area["description"])}</p>'
            f'<p class="action-row"><a class="button" href="/restaurants/?area={e(area["slug"])}">Show {area["count"]} {restaurant_count_word(area["count"], label=True)}</a> '
            f'<a class="button secondary" href="/map/?area={e(area["slug"])}">Map this town</a></p>'
            f'<div class="card-grid">{"".join(card(restaurant, "h2") for restaurant in group)}</div>'
            "</div></article>"
        )
        description = fit_meta(
            area["description"],
            f"Restaurants in {area['fullName']} on Scenic Highway 30A, Walton County, Florida.",
        )
        write(
            ROOT / "areas" / area["slug"] / "index.html",
            layout(
                f'{area["fullName"]} restaurants | Eating on 30A',
                description,
                f'/areas/{area["slug"]}/',
                "areas",
                body,
                json_ld(
                    graph(
                        {
                            "@type": "CollectionPage",
                            "name": f'{area["fullName"]} restaurants',
                            "url": f'{ORIGIN}/areas/{area["slug"]}/',
                            "description": description,
                            "isPartOf": {"@id": ORIGIN + "/#website"},
                        },
                        {
                            "@type": "ItemList",
                            "name": f'Restaurants in {area["fullName"]}',
                            "numberOfItems": len(group),
                            "itemListElement": [
                                {
                                    "@type": "ListItem",
                                    "position": index,
                                    "name": restaurant["name"],
                                    "url": f"{ORIGIN}/restaurants/{restaurant['slug']}/",
                                }
                                for index, restaurant in enumerate(group, start=1)
                            ],
                        },
                        breadcrumbs(
                            [
                                ("Home", "/"),
                                ("Towns", "/areas/"),
                                (area["fullName"], f"/areas/{area['slug']}/"),
                            ]
                        ),
                    )
                ),
                image=area["image"],
                image_alt=f'{area["fullName"]} on Scenic Highway 30A' if area["image"] else SHARE_ALT,
            ),
        )


def build_about() -> None:
    body = (
        '<div class="wrap page-intro prose"><p class="kicker">About</p>'
        "<h1>The 30A restaurant guide</h1>"
        f"<p>{e(ABOUT)}</p>"
        f"<p>{e(TOWNS)}</p>"
        '<p><a class="button" href="/restaurants/">See the restaurants</a></p></div>'
    )
    write(
        ROOT / "about" / "index.html",
        layout(
            "About the Eating on 30A restaurant guide",
            "Find breakfast, lunch, and dinner on Scenic Highway 30A in Walton County, Florida, from Dune Allen to Inlet Beach.",
            "/about/",
            "about",
            body,
            json_ld(
                graph(
                    {
                        "@type": "AboutPage",
                        "name": "About Eating on 30A",
                        "url": ORIGIN + "/about/",
                        "isPartOf": {"@id": ORIGIN + "/#website"},
                        "description": ABOUT,
                    },
                    breadcrumbs([("Home", "/"), ("About", "/about/")]),
                )
            ),
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
            "Contact Eating on 30A about a listing",
            "How to correct a restaurant listing in the Eating on 30A guide for Scenic Highway 30A in Walton County, Florida.",
            "/contact/",
            "",
            body,
            json_ld(
                graph(
                    {
                        "@type": "ContactPage",
                        "name": "Contact Eating on 30A",
                        "url": ORIGIN + "/contact/",
                        "isPartOf": {"@id": ORIGIN + "/#website"},
                    },
                    breadcrumbs([("Home", "/"), ("Contact", "/contact/")]),
                )
            ),
            include_js=False,
        ),
    )


def build_404() -> None:
    body = (
        '<div class="wrap page-intro prose"><p class="kicker">Not found</p><h1>That page is not on the menu.</h1>'
        '<p>Try the restaurant directory or the map.</p>'
        '<p><a class="button" href="/restaurants/">Browse restaurants</a></p></div>'
    )
    write(
        ROOT / "404.html",
        layout(
            "Page not found | Eating on 30A",
            "That page is not on the Eating on 30A guide to restaurants along Scenic Highway 30A in Walton County, Florida.",
            "/404.html",
            "",
            body,
            json_ld(
                {
                    "@context": "https://schema.org",
                    "@type": "WebPage",
                    "name": "Page not found",
                    "url": ORIGIN + "/404.html",
                    "isPartOf": {"@id": ORIGIN + "/#website"},
                }
            ),
            include_js=False,
            noindex=True,
        ),
    )


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
        "meta-externalagent",
        "FacebookBot",
    ]
    blocks = [
        "# Search and AI crawlers may read this site.",
        f"# {ORIGIN}/llms.txt",
        f"# {ORIGIN}/llms-full.txt",
        "",
    ]
    blocks.extend(f"User-agent: {agent}\nAllow: /\n" for agent in agents)
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
        TOWNS,
        "",
        f"- [Home]({ORIGIN}/)",
        f"- [Restaurants]({ORIGIN}/restaurants/)",
        f"- [Map]({ORIGIN}/map/)",
        f"- [Towns]({ORIGIN}/areas/)",
        f"- [About]({ORIGIN}/about/): A restaurant guide for Scenic Highway 30A.",
        f"- [Contact]({ORIGIN}/contact/): How to correct a listing.",
        "",
        "## Towns",
        "",
    ]
    for area in areas:
        lines.append(f"- [{area['fullName']}]({ORIGIN}/areas/{area['slug']}/): {area['description']}")
    lines.extend(
        [
            "",
            "## Restaurants",
            "",
        ]
    )
    for restaurant in restaurants:
        lines.append(
            f"- [{restaurant['name']}]({ORIGIN}/restaurants/{restaurant['slug']}/): {restaurant['area']} on Scenic Highway 30A."
        )
    lines.extend(
        [
            "",
            "## Optional",
            "",
            f"- [Extended guide for language models]({ORIGIN}/llms-full.txt): The same pages, with a short note for each restaurant.",
            f"- [Sitemap]({ORIGIN}/sitemap.xml): Every public page on this site.",
        ]
    )
    write(ROOT / "llms.txt", "\n".join(lines) + "\n")
    full = [
        "# Eating on 30A",
        "",
        "> Restaurant guide for Scenic Highway 30A in Walton County, Florida.",
        "",
        ABOUT,
        "",
        "Each profile gives the street address and a map pin. A photograph appears when the listing has one.",
        "",
        f"- [Home]({ORIGIN}/)",
        f"- [Restaurants]({ORIGIN}/restaurants/)",
        f"- [Map]({ORIGIN}/map/)",
        f"- [Towns]({ORIGIN}/areas/)",
        f"- [About]({ORIGIN}/about/)",
        f"- [Contact]({ORIGIN}/contact/)",
        f"- [Short index]({ORIGIN}/llms.txt)",
        f"- [Sitemap]({ORIGIN}/sitemap.xml)",
        "",
        "## Restaurants",
        "",
    ]
    for restaurant in restaurants:
        bits = ", ".join(restaurant["cuisines"]) or restaurant["category"] or "Restaurant"
        meals = ", ".join(restaurant["meals"])
        address = restaurant["address"] or restaurant["area"]
        full.append(
            f"- [{restaurant['name']}]({ORIGIN}/restaurants/{restaurant['slug']}/): {address}. {bits}; {meals}. {snippet(restaurant['notes'], 180)}"
        )
    full.extend(["", "## Towns", ""])
    for area in areas:
        full.append(f"- [{area['fullName']}]({ORIGIN}/areas/{area['slug']}/): {area['description']}")
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
