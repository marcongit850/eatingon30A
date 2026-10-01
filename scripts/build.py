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
from urllib.parse import quote, unquote, urlencode

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG = json.loads((ROOT / "site.config.json").read_text(encoding="utf-8"))
ORIGIN = os.environ.get("SITE_ORIGIN", CONFIG["origin"]).rstrip("/")
SHARE_IMAGE = "/images/og-scenic-30a.jpg"
SHARE_ALT = "Gulf water and white sand along Scenic Highway 30A in Walton County, Florida."
# Local homepage hero. Replaces the Wix photo on the "all of 30A" location row.
HERO_IMAGE = "/images/hero-beachside-dining.jpg"
HERO_WEBP = "/images/hero-beachside-dining.webp"
HERO_ALT = "A beachside table set with oysters, fish tacos, brunch, a cocktail, and coffee, with the Gulf in the background."

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
AREA_PHOTO_DIR = ROOT / "images" / "areas"
PHOTO_EXTS = (".jpg", ".jpeg", ".webp", ".png")

ABOUT = (
    "Eating on 30A is a restaurant guide for Scenic Highway 30A in South Walton. "
    "Find breakfast, lunch, and dinner from Dune Allen to Inlet Beach, "
    "with the address, the hours, and a feel for the place."
)
ABOUT_LEAD = (
    "Eating on 30A is your guide to dining along Scenic Highway 30A in South Walton. "
    "Discover breakfast, lunch, and dinner from Dune Allen to Inlet Beach, with restaurant locations, hours, and a sense of what to expect before you go."
)
ABOUT_TOWNS = (
    "Explore the communities along 30A, including Dune Allen, Gulf Place, Blue Mountain Beach, Grayton Beach, "
    "WaterColor, Seaside, Seagrove, Seacrest, Watersound, Alys Beach, Rosemary Beach, Inlet Beach, and Watersound Origins."
)
PRINT_GUIDES = (
    "Looking ahead, we’ll also be launching a printed version of the \"Eating In\" guides in 2027, "
    "bringing the same curated experience into a high-quality physical format you can bring along."
)
WINDOW_DECAL_IMAGE = "/images/eating-on-30a-window-decal.png"
WINDOW_DECAL_ALT = (
    "Circular Eating on 30A window decal, with a sun, fork, and knife over the Gulf and a QR code."
)
PRINT_COVERS = (
    (
        "/images/guides/eating-in-destin-spring-summer-2027",
        "Spring/Summer 2027 cover of Eating In Destin, a printed restaurant guide, showing oysters, fish tacos, and drinks on a harbor table.",
    ),
    (
        "/images/guides/eating-on-30a-spring-summer-2027",
        "Spring/Summer 2027 cover of Eating on 30A, a printed restaurant guide, showing seared scallops in front of white beach houses along the Gulf.",
    ),
)
TOWNS = (
    "The towns along the highway are Dune Allen, Gulf Place, Blue Mountain, Grayton Beach, "
    "WaterColor, Seaside, Seagrove, Seacrest, Watersound, Alys Beach, Rosemary Beach, "
    "Inlet Beach, and Watersound Origins."
)


def e(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def claim_listing_href(name: str) -> str:
    """Contact page with the restaurant name and a claim/correct subject filled in."""
    return "/contact/?" + urlencode(
        {
            "restaurant": name,
            "subject": f"Claim or correct: {name}",
        },
        quote_via=quote,
    )


def window_decal_href() -> str:
    """Contact page with a free window-decal note, using the same subject query as a claim."""
    return "/contact/?" + urlencode({"subject": "Free window decal"}, quote_via=quote)


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


def local_area_photo(slug: str) -> str | None:
    """Town card photo dropped in images/areas/<slug>.<ext>."""
    for ext in PHOTO_EXTS:
        if (AREA_PHOTO_DIR / f"{slug}{ext}").is_file():
            return f"/images/areas/{slug}{ext}"
    return None


def area_photo(slug: str, raw: str) -> str | None:
    """CSV image first, then a local file named for the town slug."""
    raw = (raw or "").strip()
    if raw.startswith("/images/"):
        if (ROOT / raw.lstrip("/")).is_file():
            return raw
    remote = wix_to_url(raw, 1200, 800)
    if remote:
        return remote
    return local_area_photo(slug)


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


def website_link(url: str) -> str:
    """The restaurant's own site. Opens in a new tab; guide navigation stays in this tab."""
    if not url:
        return ""
    host = re.sub(r"^www\.", "", re.sub(r"^https?://", "", url).split("/")[0])
    return f'<a href="{e(url)}" target="_blank" rel="noopener noreferrer">{e(host)}</a>'


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


def fold_name(value: str) -> str:
    """Lowercase a listing name so apostrophes and & match plain text."""
    text = unicodedata.normalize("NFKD", value or "")
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


# Each rule must match exactly one published row. The build stops if a name is missing.
LAURENS_FAVORITE_MATCHERS = (
    ("Fish Out of Water", lambda name, area: name == "fish out of water"),
    ("Raw and Juicy (Alys Beach)", lambda name, area: name == "raw and juicy" and "alys" in area),
    (
        "Pescado Seafood Grill & Rooftop Bar",
        lambda name, area: name == "pescado seafood grill and rooftop bar",
    ),
    ("Mimmo’s / Mimmos", lambda name, area: name.startswith("mimmo")),
    ("Old Florida Fish House", lambda name, area: name == "old florida fish house"),
    ("Surfing Deer", lambda name, area: name.startswith("surfing deer")),
)


def laurens_favorite_ids(rows: list[dict]) -> set[str]:
    published = [row for row in rows if clean_text(row.get("Status")) == "PUBLISHED"]
    ids: set[str] = set()
    for label, matcher in LAURENS_FAVORITE_MATCHERS:
        hits = [
            row
            for row in published
            if matcher(fold_name(row.get("Restaurant Name")), fold_name(row.get("map_area") or ""))
        ]
        if len(hits) != 1:
            found = ", ".join(clean_text(row.get("Restaurant Name")) for row in hits) or "no match"
            raise SystemExit(f"Lauren’s Favorites: {label} matched {found}")
        row_id = clean_text(hits[0].get("ID"))
        if not row_id or row_id in ids:
            raise SystemExit(f"Lauren’s Favorites: {label} did not map to a unique row")
        ids.add(row_id)
    return ids


def load_restaurants() -> list[dict]:
    used: set[str] = set()
    restaurants = []
    rows = load_rows(DATA / "restaurants.csv")
    favorite_ids = laurens_favorite_ids(rows)
    for row in rows:
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
                "laurensFavorite": clean_text(row.get("ID")) in favorite_ids,
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
            "image": area_photo(slug, row.get("Location Image") or ""),
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
        if not area.get("image"):
            area["image"] = local_area_photo(slug)
        ordered.append(area)
    return ordered


def hero_image() -> str | None:
    if (ROOT / HERO_IMAGE.lstrip("/")).is_file():
        return HERO_IMAGE
    for row in load_rows(DATA / "locations.csv"):
        if slugify(row.get("area_slug") or "") == "30a":
            return wix_to_url(row.get("Location Image") or "", 1800, 1200)
    return None


def hero_markup(hero: str | None) -> tuple[str, str]:
    if not hero:
        return "", SHARE_ALT
    alt = HERO_ALT if hero == HERO_IMAGE else SHARE_ALT
    width, height = 1800, 1200
    if hero.startswith("/"):
        info = local_image_info(ROOT / hero.lstrip("/"))
        if info:
            width, height = info[0], info[1]
    img = (
        f'<img class="hero-photo" src="{e(hero)}" alt="{e(alt)}" width="{width}" height="{height}">'
    )
    if hero == HERO_IMAGE and (ROOT / HERO_WEBP.lstrip("/")).is_file():
        img = f'<picture><source srcset="{e(HERO_WEBP)}" type="image/webp">{img}</picture>'
    return img, alt


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
            f'data-laurens-favorite="{yes_no(restaurant["laurensFavorite"])}"',
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


def fit_meta(lead: str, identity: str, pad: str = "Hours, address, and map are on the profile.") -> str:
    """Build a unique description in the same length range as the other 30A sites."""
    lead = clean_text(lead).rstrip(".")
    identity = clean_text(identity)
    text = f"{lead}. {identity}" if lead else identity
    if len(text) > 165:
        room = 165 - len(identity) - 2
        cut = ""
        if lead and room >= 40:
            # Keep a whole sentence from the listing note. A mid-sentence cut reads as a fragment.
            sentence = re.split(r"(?<=[.!?])\s+", lead)[0].rstrip(".")
            if sentence and 40 <= len(sentence) <= room:
                cut = sentence
        text = f"{cut}. {identity}" if cut else identity
    if len(text) < 110 and pad:
        text = f"{text} {pad}"
    if len(text) > 165:
        text = identity if len(identity) <= 165 else text[:165].rsplit(" ", 1)[0].rstrip(".,;:")
    return text


def cuisine_phrase(cuisines: list[str], limit: int = 2) -> str:
    names = [name for name in cuisines if name][:limit]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return f"{names[0]} and {names[1]}"


def lead_cuisine(cuisines: list[str]) -> str:
    """Prefer a specific cuisine over American when the listing has both."""
    for cuisine in cuisines:
        if cuisine and cuisine != "American":
            return cuisine
    return cuisines[0] if cuisines else ""


def name_has_area(restaurant: dict) -> bool:
    return restaurant["area"].lower() in restaurant["name"].lower()


def name_has_30a(restaurant: dict) -> bool:
    return "30a" in restaurant["name"].lower()


def title_place(restaurant: dict) -> str:
    if name_has_area(restaurant):
        return "on 30A"
    if name_has_30a(restaurant):
        return f"in {restaurant['area']}"
    return f"in {restaurant['area']}, 30A"


def listing_where(restaurant: dict) -> str:
    """Local cue for meta descriptions. Always keeps 30A and Walton County available."""
    if name_has_area(restaurant):
        return "on 30A, Walton County, Florida"
    if name_has_30a(restaurant):
        return f"in {restaurant['area']}, Walton County, Florida"
    return f"in {restaurant['area']} on 30A, Walton County, Florida"


def listing_identity(restaurant: dict) -> str:
    where = listing_where(restaurant)
    cuisine = lead_cuisine(restaurant["cuisines"])
    if cuisine:
        return f"{restaurant['name']}, {cuisine} {where}."
    return f"{restaurant['name']} {where}."


ABBREVIATIONS = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Co|Inc|LLC|Ltd|Ave|Blvd|Hwy|vs|etc)\.")


def first_sentence(text: str) -> str:
    """First full sentence, ignoring titles like Mr. Short fragments are not used."""
    text = clean_text(text)
    if not text:
        return ""
    protected = ABBREVIATIONS.sub(lambda match: match.group(0).replace(".", "\u0000"), text)
    sentence = re.split(r"(?<=[.!?])\s+", protected)[0].strip().replace("\u0000", ".")
    sentence = sentence.rstrip(".")
    if len(sentence) < 40:
        return ""
    return sentence


def meal_words(meals: list[str]) -> list[str]:
    words = []
    for meal in MEAL_ORDER:
        if meal in meals:
            words.append("dessert" if meal == "Desserts" else meal.lower())
    for meal in meals:
        word = "dessert" if meal == "Desserts" else meal.lower()
        if word not in words:
            words.append(word)
    return words


def food_phrase(restaurant: dict, cuisine: str) -> str:
    picked = []
    for food in restaurant["foods"]:
        if cuisine and food.lower() == cuisine.lower():
            continue
        picked.append(food.lower())
        if len(picked) == 2:
            break
    return human_list(picked)


def meta_ok(text: str) -> bool:
    return 110 <= len(text) <= 165 and "30A" in text and "Walton County" in text


def listing_description(restaurant: dict) -> str:
    """Unique meta description from the listing. No invented hours, ratings, or counts."""
    identity = listing_identity(restaurant)
    cuisine = lead_cuisine(restaurant["cuisines"])
    note = first_sentence(restaurant["notes"])
    meals = meal_words(restaurant["meals"])
    meal = f"Open for {human_list(meals)}" if meals else ""
    food = food_phrase(restaurant, cuisine)
    options = []
    if note:
        options.append(f"{identity} {note}.")
    if meal:
        options.append(f"{identity} {meal}.")
        if food:
            options.append(f"{identity} {meal}, with {food}.")
        if restaurant["laurensFavorite"]:
            options.append(f"{identity} {meal}. One of Lauren’s Favorites.")
    elif food:
        options.append(f"{identity} Food on the listing: {food}.")
    if restaurant["laurensFavorite"]:
        options.append(f"{identity} One of Lauren’s Favorites.")
    base = f"{identity} {meal}." if meal else identity
    for pad in (
        "Hours, address, and map are on the profile.",
        "Address, hours, and map are on this page.",
        "See the address and hours on this page.",
    ):
        options.append(f"{base} {pad}".replace("..", "."))
    for option in options:
        text = clean_text(option)
        if meta_ok(text):
            return text
    text = clean_text(options[-1]) if options else identity
    if len(text) > 165:
        text = text[:165].rsplit(" ", 1)[0].rstrip(".,;:")
    return text


def listing_title(restaurant: dict) -> str:
    name = restaurant["name"]
    area = restaurant["area"]
    cuisine = lead_cuisine(restaurant["cuisines"])
    place = title_place(restaurant)
    options = []
    if cuisine and place:
        options.append(f"{name} | {cuisine} {place}")
    elif cuisine:
        options.append(f"{name} | {cuisine} on 30A")
    options.extend(
        [
            f"{name} in {area} | 30A restaurants",
            f"{name} in {area} | Eating on 30A",
            f"{name} | {area} on 30A",
            f"{name} | Eating on 30A",
        ]
    )
    for option in options:
        if 20 <= len(option) <= 70:
            return option
    trimmed = options[-1][:70].rsplit(" ", 1)[0].rstrip(".,;:|")
    return trimmed if len(trimmed) >= 20 else options[-1][:70]


def intro_place(restaurant: dict) -> str:
    if name_has_area(restaurant):
        return "on Scenic Highway 30A"
    return f"in {restaurant['area']} on Scenic Highway 30A"


CUISINE_INTRO = {
    "American": "serves American food",
    "Seafood": "serves seafood",
    "Cafe": "is a cafe",
    "Italian": "serves Italian food",
    "Dessert": "is a dessert stop",
    "Southern": "serves Southern food",
    "Mexican": "serves Mexican food",
    "Asian": "serves Asian food",
    "Japanese": "serves Japanese food",
    "Mediterranean": "serves Mediterranean food",
    "BBQ": "serves barbecue",
    "French": "serves French food",
    "Venezuelan": "serves Venezuelan food",
    "Cuban": "serves Cuban food",
    "Irish": "serves Irish food",
    "Sushi": "serves sushi",
}


def listing_intro(restaurant: dict) -> str:
    """One short on-page intro from fields already on the listing. No counts, no guessed facts."""
    cuisine = lead_cuisine(restaurant["cuisines"])
    place = intro_place(restaurant)
    if cuisine:
        verb = CUISINE_INTRO.get(cuisine, f"serves {cuisine}")
        sentences = [f"{restaurant['name']} {verb} {place}."]
    else:
        sentences = [f"{restaurant['name']} is {place}."]
    subarea = restaurant["subarea"]
    if subarea and subarea.lower() not in restaurant["name"].lower() and subarea.lower() != restaurant["area"].lower():
        sentences.append(f"It’s in {subarea}.")
    meals = meal_words(restaurant["meals"])
    if meals:
        sentences.append(f"Come by for {human_list(meals)}.")
    amenities = []
    if restaurant["outdoor"]:
        amenities.append("outdoor dining")
    if restaurant["music"]:
        amenities.append("live music")
    if restaurant["reservations"]:
        amenities.append("reservations")
    if restaurant["happyDrinks"] or restaurant["happyFood"]:
        amenities.append("happy hour")
    if amenities:
        sentences.append(f"The listing includes {human_list(amenities[:3])}.")
    if restaurant["kids"]:
        sentences.append("It’s marked kid friendly.")
    if restaurant["laurensFavorite"]:
        sentences.append("It’s one of Lauren’s Favorites.")
    return " ".join(sentences)


def area_cuisines(group: list[dict], limit: int = 3) -> list[str]:
    found = []
    for restaurant in group:
        for cuisine in restaurant["cuisines"]:
            if cuisine and cuisine not in found:
                found.append(cuisine)
            if len(found) == limit:
                return found
    return found


def area_description(area: dict, group: list[dict]) -> str:
    identity = f"Restaurants in {area['fullName']} on Scenic Highway 30A, Walton County, Florida."
    text = fit_meta(area["description"], identity, "Addresses and hours are listed with each restaurant.")
    top = area_cuisines(group, 2)
    count = f" {area['count']} {restaurant_count_word(area['count'])}"
    extra = count + (f", including {', '.join(top)}." if top else ".")
    if len(text) + len(extra) <= 165:
        text += extra
    return text


def area_intro(area: dict, group: list[dict]) -> str:
    top = area_cuisines(group)
    detail = f"{area['count']} {restaurant_count_word(area['count'])}"
    if top:
        detail += f", including {', '.join(top)}"
    return (
        f"Find restaurants in {area['fullName']} on Scenic Highway 30A. "
        f"The guide lists {detail}."
    )


def area_title(area: dict) -> str:
    title = f"Restaurants in {area['fullName']} on 30A | Eating on 30A"
    if len(title) <= 70:
        return title
    shorter = f"{area['fullName']} restaurants on 30A | Eating on 30A"
    return shorter if len(shorter) <= 70 else f"{area['fullName']} restaurants | Eating on 30A"


def newest(dates) -> str:
    values = [item for item in dates if item]
    return max(values) if values else ""


def postal_address(restaurant: dict) -> dict:
    address = {
        "@type": "PostalAddress",
        "streetAddress": restaurant["street"] or restaurant["address"],
        "addressLocality": restaurant["city"] or restaurant["area"],
        "addressRegion": restaurant["region"] or "FL",
        "addressCountry": "US",
    }
    if restaurant["postal"]:
        address["postalCode"] = restaurant["postal"]
    return address


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
    extra_scripts: str = "",
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
        + extra_scripts
        + "\n</body>\n</html>\n"
    )


def json_ld(data: dict | list) -> str:
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    return f'<script type="application/ld+json">{payload}</script>\n'


def area_names(areas: list[dict]) -> str:
    payload = {area["slug"]: area["fullName"] for area in areas}
    return json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")


def view_switch(current: str) -> str:
    """List and Map links beside the filters. Query state is copied onto both."""
    choices = (
        ("list", "/restaurants/", "List"),
        ("map", "/map/", "Map"),
    )
    links = []
    for key, path, label in choices:
        current_attr = ' aria-current="page"' if key == current else ""
        links.append(f'<a href="{path}" data-view-href="{path}"{current_attr}>{label}</a>')
    script = (
        "<script>!function(){var q=location.search;if(!q)return;"
        "var nodes=document.querySelectorAll('[data-view-href]');"
        "for(var i=0;i<nodes.length;i++)nodes[i].href=nodes[i].getAttribute('data-view-href')+q;"
        "}();</script>"
    )
    return (
        '<div class="view-field"><span>View</span>'
        f'<nav class="view-switch" aria-label="List or map">{"".join(links)}</nav></div>'
        + script
    )


def browse_by_area(areas: list[dict]) -> str:
    """Town pages under the listings, away from the filter controls."""
    items = "".join(
        f'<li><a href="/areas/{e(area["slug"])}/">{e(area["fullName"])}</a></li>'
        for area in areas
    )
    return (
        '<section class="browse-areas" id="browse-areas" aria-labelledby="browse-areas-title">'
        '<h2 id="browse-areas-title">Browse by area</h2>'
        f'<ul class="area-index">{items}</ul>'
        "</section>"
    )


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
        '<label class="check"><input type="checkbox" name="laurensFavorite" value="yes"><span>Lauren’s Favorites</span></label>'
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
        "laurensFavorite": restaurant["laurensFavorite"],
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
        '<p class="kicker">Featured</p>'
        f"<h2>{e(feature['name'])}</h2>"
        f'<p class="lede">{e(snippet(feature["notes"], 240))}</p>'
        f'<p class="meta">{e(meta)}</p>'
        f'<p><a class="text-link" href="/restaurants/{e(feature["slug"])}/">View restaurant</a></p>'
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
            f'<a class="town" href="/areas/{e(area["slug"])}/">'
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
            '<section class="section cover-section" id="from-the-guide" aria-label="Featured">'
            '<div class="wrap cover-stage">'
            f"{controls}{slots}</div>{FEATURED_ROTATION}</section>"
        )
    hero_html, hero_alt = hero_markup(hero)
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
        "<p>Select a community to explore restaurants along that stretch of 30A.</p></div>"
        f'<div class="town-grid">{"".join(towns)}</div>'
        '<p class="section-links"><a class="text-link" href="/areas/">Town notes</a><a class="text-link" href="/map/">The map</a></p>'
        "</div></section>"
        '<section class="section"><div class="wrap essay-grid">'
        '<div><p class="kicker">The corridor</p><h2>A guide for the whole coast.</h2></div>'
        '<div><div class="prose">'
        f"<p>{e(ABOUT)}</p>"
        '<p><a class="button" href="/restaurants/">Browse the directory</a></p></div>'
        '<p class="kicker">Guides</p>'
        '<p class="lede">Popular guides for a trip along Scenic Highway 30A. Breakfast, seafood, and the rest of the list are on the guides page.</p>'
        '<p class="section-links"><a class="text-link" href="/guides/best-seafood-30a/">Best seafood on 30A</a>'
        '<a class="text-link" href="/guides/breakfast-30a/">Breakfast on 30A</a>'
        '<a class="text-link" href="/guides/">All guides</a></p></div>'
        "</div></section>"
    )
    description = (
        "Find restaurants and food along Scenic Highway 30A in Walton County, Florida, "
        "by meal, town, or cuisine, with a directory and a map."
    )
    extra = json_ld(
        graph(
            {
                "@type": "Organization",
                "@id": ORIGIN + "/#organization",
                "name": "Eating on 30A",
                "url": ORIGIN + "/",
                "description": ABOUT,
                "logo": ORIGIN + "/images/eating-on-30a-logo.png",
                "areaServed": {
                    "@type": "Place",
                    "name": "Scenic Highway 30A, Walton County, Florida",
                },
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
            image_alt=hero_alt,
        ),
    )


def build_directory(restaurants: list[dict], areas: list[dict], cuisines: list[str]) -> None:
    pending = (
        "<script>!function(){var p=new URLSearchParams(location.search);"
        "['meal','area','cuisine','q','outdoor','kids','music','laurensFavorite'].some(function(k){return p.get(k)})"
        "&&document.documentElement.classList.add('js-filter')}();</script>\n"
    )
    cards = "".join(card(restaurant) for restaurant in restaurants)
    description = (
        "Restaurants on Scenic Highway 30A in Walton County, Florida. "
        f"Search by town, meal, and cuisine. All {len(restaurants)} listings are here."
    )
    body = (
        '<div class="wrap page-intro">'
        '<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> Restaurants</p>'
        '<p class="kicker">Directory</p>'
        '<h1 id="listing-title">Restaurants on 30A</h1>'
        '<p class="lede">Find restaurants along Scenic Highway 30A in Walton County. Filter by beach town, meal, or a few words.</p>'
        f"{view_switch('list')}"
        f"{filter_form(areas, cuisines)}"
        f'<p id="result-count" class="count" aria-live="polite">{len(restaurants)} restaurants</p>'
        f'<p id="empty" class="empty" hidden>No restaurants match. <a href="/restaurants/">Clear the filters</a>.</p>'
        f'<div id="cards" class="card-grid">{cards}</div>'
        f"{browse_by_area(areas)}</div>"
    )
    extra = pending + json_ld(
        graph(
            {
                "@type": "CollectionPage",
                "@id": ORIGIN + "/restaurants/#page",
                "name": "Restaurants on Scenic Highway 30A",
                "url": ORIGIN + "/restaurants/",
                "isPartOf": {"@id": ORIGIN + "/#website"},
                "description": description,
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
            "Restaurants on Scenic Highway 30A | Eating on 30A",
            description,
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
    if restaurant["laurensFavorite"]:
        flags.append("Lauren’s Favorites")
    if restaurant["happyDrinks"]:
        flags.append("Happy hour drinks")
    if restaurant["happyFood"]:
        flags.append("Happy hour food")
    if restaurant["reservations"]:
        flags.append("Takes reservations")
    for flag in flags:
        chips.append(f"<li>{e(flag)}</li>")
    phone = f'<a href="{e(restaurant["tel"])}">{e(restaurant["phone"])}</a>' if restaurant["tel"] else ""
    website = website_link(restaurant["website"])
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
    area_page = f'/areas/{restaurant["areaSlug"]}/'
    area_href = area_page
    area_line = restaurant["label"] or restaurant["area"]
    price_bit = f' · {e(restaurant["price"])}' if restaurant["price"] else ""
    category_bit = f' · {e(restaurant["category"])}' if restaurant["category"] else ""
    map_block = f'<div class="wrap profile-map">{map_html}</div>' if map_html else ""
    claim = (
        f'<p class="listing-claim"><a href="{e(claim_listing_href(restaurant["name"]))}">Claim or correct this listing</a></p>'
    )
    if nearby_html:
        more = (
            f'<section class="wrap more"><h2>Also in {e(restaurant["area"])}</h2>'
            f'<div class="map-list">{nearby_html}</div>'
            f'<p><a class="text-link" href="{e(area_page)}">All restaurants in {e(restaurant["area"])}</a></p>'
            f"{claim}</section>"
        )
    else:
        more = (
            f'<section class="wrap more"><p><a class="text-link" href="{e(area_href)}">{e(restaurant["area"])} in the guide</a></p>'
            f"{claim}</section>"
        )
    body = (
        '<article class="profile">'
        f'<div class="profile-hero">{media_block(restaurant["heroImage"], photo_alt(restaurant), restaurant["tone"], shot_label(restaurant), eager=True, name=restaurant["name"])}</div>'
        f"{filmstrip(restaurant)}"
        '<div class="wrap profile-head">'
        f'<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/restaurants/">Restaurants</a> <span aria-hidden="true">/</span> <a href="{e(area_page)}">{e(restaurant["area"])}</a> <span aria-hidden="true">/</span> {e(restaurant["name"])}</p>'
        f'<p class="eyebrow"><a href="{e(area_href)}">{e(area_line)}</a>{price_bit}{category_bit}</p>'
        f"<h1>{e(restaurant['name'])}</h1>"
        f'<ul class="chips">{"".join(chips)}</ul>'
        "</div>"
        '<div class="wrap profile-grid">'
        f'<div class="prose profile-story"><p>{e(listing_intro(restaurant))}</p>'
        + (f'<p>{e(restaurant["notes"])}</p>' if restaurant["notes"] else "")
        + "</div>"
        f"<aside>{logo}<dl class=\"facts\">{facts}</dl></aside>"
        "</div>"
        f"{map_block}{more}"
        "</article>"
    )
    description = listing_description(restaurant)
    page_url = f"{ORIGIN}/restaurants/{restaurant['slug']}/"
    same_as = [url for url in (restaurant["website"], restaurant["instagram"], restaurant["facebook"]) if url]
    schema = {
        "@type": ["Restaurant", "LocalBusiness"],
        "@id": page_url + "#restaurant",
        "name": restaurant["name"],
        "url": page_url,
        "description": description,
        "address": postal_address(restaurant),
        "areaServed": {
            "@type": "Place",
            "name": restaurant["area"],
        },
        "containedInPlace": {
            "@type": "Place",
            "name": restaurant["area"],
            "url": ORIGIN + area_page,
        },
        "isPartOf": {"@id": ORIGIN + "/#website"},
    }
    if restaurant["cuisines"]:
        schema["servesCuisine"] = restaurant["cuisines"]
    if restaurant["price"]:
        schema["priceRange"] = restaurant["price"]
    if restaurant["phone"]:
        schema["telephone"] = restaurant["phone"]
    if restaurant["reservations"]:
        schema["acceptsReservations"] = True
    if restaurant["lat"] is not None:
        schema["geo"] = {"@type": "GeoCoordinates", "latitude": restaurant["lat"], "longitude": restaurant["lng"]}
    if restaurant["heroImage"]:
        image = restaurant["heroImage"]
        schema["image"] = image if image.startswith(("http://", "https://")) else ORIGIN + image
    if restaurant["logo"]:
        logo_url = restaurant["logo"]
        schema["logo"] = logo_url if logo_url.startswith(("http://", "https://")) else ORIGIN + logo_url
    if same_as:
        schema["sameAs"] = same_as
    # Hours stay in the visible facts list. CSV hours are free text, so they are not
    # copied into openingHours. Ratings and reviews are never invented.
    title = listing_title(restaurant)
    webpage = {
        "@type": "WebPage",
        "@id": page_url + "#webpage",
        "url": page_url,
        "name": title,
        "description": description,
        "isPartOf": {"@id": ORIGIN + "/#website"},
        "mainEntity": {"@id": page_url + "#restaurant"},
    }
    extra = json_ld(
        graph(
            webpage,
            schema,
            breadcrumbs(
                [
                    ("Home", "/"),
                    ("Restaurants", "/restaurants/"),
                    (restaurant["area"], area_page),
                    (restaurant["name"], f"/restaurants/{restaurant['slug']}/"),
                ]
            ),
        )
    )
    require_meta(title, description)
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
        '<div class="wrap page-intro">'
        '<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> Map</p>'
        '<p class="kicker">The map</p>'
        '<h1 id="listing-title">Along the coast</h1>'
        "<p class=\"lede\">Explore restaurants on the map using the same filters as the directory. Tap a pin to see the restaurant name, street address, and full profile.</p>"
        + view_switch("map")
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
        '<div class="wrap page-intro">'
        '<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> Towns</p>'
        '<p class="kicker">West to east</p><h1>Beach Towns of 30A</h1>'
        '<p class="lede">From Dune Allen to Inlet Beach, explore the communities of 30A and find restaurants in each one.</p>'
        '<p class="lede">Each town page lists the restaurants on that stretch of Scenic Highway 30A.</p>'
        f'<div class="town-grid">{"".join(cards)}</div></div>'
    )
    write(
        ROOT / "areas" / "index.html",
        layout(
            "30A beach towns and restaurants | Eating on 30A",
            "Find restaurants in the beach towns along Scenic Highway 30A in Walton County, Florida, from Dune Allen Beach east to Inlet Beach.",
            "/areas/",
            "areas",
            body,
            json_ld(
                graph(
                    {
                        "@type": "CollectionPage",
                        "name": "Beach towns and restaurants on 30A",
                        "url": ORIGIN + "/areas/",
                        "description": (
                            "Find restaurants in the beach towns along Scenic Highway 30A in Walton County, Florida, "
                            "from Dune Allen Beach east to Inlet Beach."
                        ),
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
        neighbors = []
        index = areas.index(area)
        if index > 0:
            west = areas[index - 1]
            neighbors.append(f'<a class="text-link" href="/areas/{e(west["slug"])}/">{e(west["fullName"])}</a>')
        if index + 1 < len(areas):
            east = areas[index + 1]
            neighbors.append(f'<a class="text-link" href="/areas/{e(east["slug"])}/">{e(east["fullName"])}</a>')
        neighbor_html = ""
        if neighbors:
            neighbor_html = f'<nav class="section-links" aria-label="More towns">{"".join(neighbors)}</nav>'
        body = (
            '<article class="profile">'
            f'<div class="profile-hero">{photo or placeholder("gulf", area["name"], area["name"])}</div>'
            '<div class="wrap page-intro">'
            f'<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/areas/">Towns</a> <span aria-hidden="true">/</span> {e(area["fullName"])}</p>'
            f'<h1 class="town-title">Restaurants in {e(area["fullName"])}</h1>'
            f'<p class="lede">{e(area["description"])}</p>'
            f'<p class="lede">{e(area_intro(area, group))}</p>'
            f'<p class="action-row"><a class="button" href="/restaurants/?area={e(area["slug"])}">Show {area["count"]} {restaurant_count_word(area["count"], label=True)}</a> '
            f'<a class="button secondary" href="/map/?area={e(area["slug"])}">Map this town</a></p>'
            f"{neighbor_html}"
            f'<div class="card-grid">{"".join(card(restaurant, "h2") for restaurant in group)}</div>'
            "</div></article>"
        )
        description = area_description(area, group)
        write(
            ROOT / "areas" / area["slug"] / "index.html",
            layout(
                area_title(area),
                description,
                f'/areas/{area["slug"]}/',
                "areas",
                body,
                json_ld(
                    graph(
                        {
                            "@type": "CollectionPage",
                            "name": f'Restaurants in {area["fullName"]}',
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
                        {
                            "@type": "Place",
                            "name": area["fullName"],
                            "url": f'{ORIGIN}/areas/{area["slug"]}/',
                            "description": description,
                            "containedInPlace": {
                                "@type": "Place",
                                "name": "Scenic Highway 30A, Walton County, Florida",
                            },
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


def print_cover(path: str, alt: str) -> str:
    return (
        "<figure><picture>"
        f'<source srcset="{e(path)}.webp" type="image/webp">'
        f'<img src="{e(path)}.jpg" alt="{e(alt)}" width="840" height="1260" loading="lazy" decoding="async">'
        "</picture></figure>"
    )


SEAFOOD_CUISINE = "Seafood"
SEAFOOD_FOOD_LABELS = (
    ("Raw Bar", "raw bars"),
    ("Oyster Bar", "oyster bars"),
    ("Seafood Market", "seafood markets"),
    ("Shrimp", "shrimp baskets"),
)
GUIDES_INDEX_TITLE = "Restaurant guides for 30A | Eating on 30A"
GUIDES_INDEX_DESCRIPTION = (
    "Guides for meals, towns, and favorites on Scenic Highway 30A in Walton County, Florida, "
    "each drawn from the restaurant directory and the map."
)
WALKABLE_AREAS = ("seaside", "alys-beach", "rosemary-beach")
SEAFOOD_GUIDE_TITLE = "Best seafood on 30A | Eating on 30A"
SEAFOOD_GUIDE_DESCRIPTION = (
    "Best seafood restaurants on Scenic Highway 30A in Walton County, Florida, "
    "from Dune Allen to Inlet Beach, with the directory and a map."
)


def require_meta(title: str, description: str) -> None:
    if not 20 <= len(title) <= 70:
        raise SystemExit(f"title length {len(title)}: {title}")
    if not 110 <= len(description) <= 165 or "30A" not in description or "Walton County" not in description:
        raise SystemExit(f"description length {len(description)}: {description}")


def or_list(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} or {items[1]}"
    return ", ".join(items[:-1]) + f", or {items[-1]}"


def human_list(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"


def west_to_east(restaurants: list[dict], areas: list[dict]) -> list[dict]:
    order = {area["slug"]: index for index, area in enumerate(areas)}
    return sorted(
        restaurants,
        key=lambda restaurant: (order.get(restaurant["areaSlug"], len(order)), restaurant["name"].lower()),
    )


def seafood_restaurants(restaurants: list[dict], areas: list[dict]) -> list[dict]:
    """Restaurants whose Cuisine Type includes Seafood, west to east, then by name.

    Related food types (raw bar, oyster bar, seafood market, shrimp) sit inside
    that cuisine set. The directory and map use the same cuisine query.
    """
    return west_to_east(
        [restaurant for restaurant in restaurants if SEAFOOD_CUISINE in restaurant["cuisines"]],
        areas,
    )


def filter_href(path: str, pairs: list[tuple[str, str]]) -> str:
    return path + "?" + urlencode(pairs)


def area_groups(picked: list[dict], areas: list[dict]) -> list[tuple[dict, list[dict]]]:
    groups = []
    for area in areas:
        group = [restaurant for restaurant in picked if restaurant["areaSlug"] == area["slug"]]
        if group:
            groups.append((area, group))
    return groups


def rank_areas(picked: list[dict], areas: list[dict]) -> tuple[list, list]:
    groups = area_groups(picked, areas)
    ranked = sorted(groups, key=lambda item: (-len(item[1]), item[0]["fullName"]))
    return groups, ranked


def name_list(rows: list[dict]) -> str:
    return human_list([restaurant["name"] for restaurant in rows])


def next_tier(groups: list, ranked: list) -> str:
    if len(ranked) < 2:
        return ""
    count = len(ranked[1][1])
    order = {id(area): index for index, (area, _group) in enumerate(groups)}
    tied = [item for item in ranked[1:] if len(item[1]) == count]
    tied.sort(key=lambda item: order.get(id(item[0]), 0))
    names = [item[0]["fullName"] for item in tied]
    if len(names) == 1:
        return f"{names[0]} is next, with {count}."
    return f"{human_list(names)} are next, with {count} each."


def faq_item(question: str, answer: str, href: str = "", label: str = "") -> dict:
    html = e(answer)
    if href:
        html += " " + text_link(href, label) + "."
    return {"question": question, "answer": answer, "html": html}


def place_phrase(restaurant: dict) -> str:
    return f"{restaurant['name']} in {restaurant['area']}"


def text_link(href: str, label: str) -> str:
    return f'<a class="text-link" href="{e(href)}">{e(label)}</a>'


def linked_places(restaurants: list[dict]) -> str:
    return human_list(
        [text_link(f"/restaurants/{restaurant['slug']}/", place_phrase(restaurant)) for restaurant in restaurants]
    )


def faq_nodes(items: list[dict]) -> dict:
    return {
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": item["question"],
                "acceptedAnswer": {"@type": "Answer", "text": item["answer"]},
            }
            for item in items
        ],
    }


def faq_html(items: list[dict]) -> str:
    blocks = [
        '<section class="guide-faq" aria-labelledby="guide-faq-heading">',
        '<h2 id="guide-faq-heading">Common questions</h2>',
    ]
    for item in items:
        blocks.append(f"<h3>{e(item['question'])}</h3><p>{item['html']}</p>")
    blocks.append("</section>")
    return "".join(blocks)


def tier_names(groups: list, ranked: list) -> str:
    """Second-place town names, west to east, with no counts."""
    if len(ranked) < 2 or len(ranked[0][1]) == len(ranked[1][1]):
        return ""
    count = len(ranked[1][1])
    order = {id(area): index for index, (area, _group) in enumerate(groups)}
    tied = [item for item in ranked[1:] if len(item[1]) == count]
    tied.sort(key=lambda item: order.get(id(item[0]), 0))
    return human_list([item[0]["fullName"] for item in tied])


def widest_choice(groups: list, ranked: list) -> str:
    top_count = len(ranked[0][1])
    leaders = [item[0]["fullName"] for item in ranked if len(item[1]) == top_count]
    if len(leaders) == 1:
        text = f"{leaders[0]} has the widest choice"
        nxt = tier_names(groups, ranked)
        if nxt:
            text += f", then {nxt}"
        return text
    return f"{human_list(leaders)} have the widest choice"


def seafood_faq(picked: list[dict], areas: list[dict]) -> list[dict]:
    groups, ranked = rank_areas(picked, areas)
    leaders = {item[0]["fullName"] for item in ranked if len(item[1]) == len(ranked[0][1])}
    second_count = len(ranked[1][1]) if len(ranked) > 1 and len(ranked[0][1]) != len(ranked[1][1]) else None
    featured = set(leaders)
    if second_count is not None:
        featured.update(item[0]["fullName"] for item in ranked if len(item[1]) == second_count)
    elsewhere = [area["fullName"] for area, _group in groups if area["fullName"] not in featured]
    where = f"{widest_choice(groups, ranked)}."
    if elsewhere:
        where += f" You’ll also find seafood in {human_list(elsewhere)}."
    kids = [restaurant for restaurant in picked if restaurant["kids"]]
    examples = []
    seen = set()
    for restaurant in kids:
        if restaurant["areaSlug"] in seen:
            continue
        examples.append(restaurant)
        seen.add(restaurant["areaSlug"])
        if len(examples) == 3:
            break
    kid_plain = human_list([place_phrase(restaurant) for restaurant in examples])
    kids_answer = (
        f"Yes. A few to start with: {kid_plain}. Other seafood places along 30A are kid friendly too."
    )
    waterfront = [restaurant for restaurant in picked if "Waterfront" in restaurant["vibes"]]
    water_plain = human_list([place_phrase(restaurant) for restaurant in waterfront])
    water_answer = f"On the water: {water_plain}."
    items = [
        {
            "question": "Where along 30A are the seafood restaurants?",
            "answer": where,
            "html": e(where) + " " + text_link("/restaurants/?cuisine=Seafood", "See them in the directory") + ".",
        }
    ]
    if kids and examples:
        items.append(
            {
                "question": "Are there kid-friendly seafood restaurants on 30A?",
                "answer": kids_answer,
                "html": (
                    e(kids_answer)
                    + " "
                    + text_link("/restaurants/?cuisine=Seafood&kids=yes", "Show kid-friendly seafood")
                    + "."
                ),
            }
        )
    if waterfront:
        items.append(
            {
                "question": "Which seafood restaurants are on the water?",
                "answer": water_answer,
                "html": e("On the water: ") + linked_places(waterfront) + ".",
            }
        )
    return items


def guide_teaser(title: str, href: str, area: str, meta: str, note: str, image: str, image_alt: str) -> str:
    return (
        f'<a class="card" href="{e(href)}">'
        f'<div class="card-media"><img src="{e(image)}" alt="{e(image_alt)}" loading="lazy"></div>'
        f'<div class="card-body"><p class="card-area">{e(area)}</p>'
        f"<h2>{e(title)}</h2>"
        f'<p class="meta">{e(meta)}</p>'
        f'<p class="note">{e(note)}</p></div></a>'
    )


def area_record(areas: list[dict], slug: str) -> dict:
    return next(area for area in areas if area["slug"] == slug)


def show_label(count: int) -> str:
    return f"Show {count} {restaurant_count_word(count, label=True)}"


def teaser_image(picked: list[dict], areas: list[dict], area_slug: str = "") -> tuple[str, str]:
    if area_slug:
        area = area_record(areas, area_slug)
        if area.get("image"):
            return area["image"], f"{area['fullName']} on Scenic Highway 30A"
    for restaurant in picked:
        if restaurant["cardImage"]:
            return restaurant["cardImage"], photo_alt(restaurant)
    return HERO_IMAGE, HERO_ALT


def subarea_phrase(picked: list[dict], town: str) -> str:
    labels = []
    counts: dict[str, int] = {}
    elsewhere = 0
    for restaurant in picked:
        if not restaurant["subarea"]:
            elsewhere += 1
            continue
        if restaurant["subarea"] not in counts:
            labels.append(restaurant["subarea"])
        counts[restaurant["subarea"]] = counts.get(restaurant["subarea"], 0) + 1
    parts = [f"{counts[label]} in {label}" for label in labels]
    if elsewhere:
        parts.append(f"{elsewhere} elsewhere in {town}")
    return human_list(parts)


def guide_spec(
    slug: str,
    h1: str,
    title: str,
    description: str,
    kicker: str,
    paragraphs: list[str],
    restaurants: list[dict],
    directory_href: str,
    map_href: str,
    faqs: list[dict],
    teaser_area: str,
    teaser_note: str,
    teaser: tuple[str, str],
    llms: str,
    extra: list[tuple[str, str]] | None = None,
    extra_label: str = "More ways to browse",
    directory_label: str = "",
    map_label: str = "Map these restaurants",
    list_name: str = "",
) -> dict:
    return {
        "slug": slug,
        "path": f"/guides/{slug}/",
        "h1": h1,
        "title": title,
        "description": description,
        "kicker": kicker,
        "paragraphs": paragraphs,
        "restaurants": restaurants,
        "directory_href": directory_href,
        "directory_label": directory_label or show_label(len(restaurants)),
        "map_href": map_href,
        "map_label": map_label,
        "faqs": faqs,
        "teaser_area": teaser_area,
        "teaser_note": teaser_note,
        "teaser_image": teaser[0],
        "teaser_alt": teaser[1],
        "llms": llms,
        "extra": extra or [],
        "extra_label": extra_label,
        "list_name": list_name or h1,
    }


def guide_picks(restaurants: list[dict], areas: list[dict]) -> list[dict]:
    """Every public guide, in index order, using published restaurant fields only."""
    ranked = west_to_east(restaurants, areas)

    def choose(pred) -> list[dict]:
        return [restaurant for restaurant in ranked if pred(restaurant)]

    seafood = seafood_restaurants(restaurants, areas)
    breakfast = choose(lambda restaurant: "Breakfast" in restaurant["meals"])
    kids = choose(lambda restaurant: restaurant["kids"])
    seaside = choose(lambda restaurant: restaurant["areaSlug"] == "seaside")
    dinner = choose(lambda restaurant: restaurant["areaSlug"] == "seaside" and "Dinner" in restaurant["meals"])
    rosemary = choose(lambda restaurant: restaurant["areaSlug"] == "rosemary-beach")
    watercolor = choose(lambda restaurant: restaurant["areaSlug"] == "watercolor")
    walkable = choose(lambda restaurant: restaurant["areaSlug"] in WALKABLE_AREAS)
    favorites = choose(lambda restaurant: restaurant["laurensFavorite"])
    cafes = choose(lambda restaurant: "Cafe" in restaurant["cuisines"])
    groups = {
        "seafood": seafood,
        "breakfast": breakfast,
        "kids": kids,
        "dinner": dinner,
        "rosemary": rosemary,
        "watercolor": watercolor,
        "walkable": walkable,
        "favorites": favorites,
        "cafes": cafes,
    }
    empty = [name for name, group in groups.items() if not group]
    if empty:
        raise SystemExit("guide is empty: " + ", ".join(empty))

    seafood_foods = [
        label
        for food, label in SEAFOOD_FOOD_LABELS
        if any(food in restaurant["foods"] for restaurant in seafood)
    ]
    seafood_href = "/restaurants/?cuisine=Seafood"
    seafood_map = "/map/?cuisine=Seafood"
    breakfast_href = "/restaurants/?meal=Breakfast"
    breakfast_map = "/map/?meal=Breakfast"
    kids_href = "/restaurants/?kids=yes"
    kids_map = "/map/?kids=yes"
    dinner_href = filter_href("/restaurants/", [("area", "seaside"), ("meal", "Dinner")])
    dinner_map = filter_href("/map/", [("area", "seaside"), ("meal", "Dinner")])
    rosemary_href = "/restaurants/?area=rosemary-beach"
    rosemary_map = "/map/?area=rosemary-beach"
    watercolor_href = "/restaurants/?area=watercolor"
    watercolor_map = "/map/?area=watercolor"
    favorites_href = "/restaurants/?laurensFavorite=yes"
    favorites_map = "/map/?laurensFavorite=yes"
    cafe_href = "/restaurants/?cuisine=Cafe"
    cafe_map = "/map/?cuisine=Cafe"
    kid_breakfast = sum(1 for restaurant in breakfast if restaurant["kids"])
    cafe_or_coffee = sum(
        1
        for restaurant in breakfast
        if "Cafe" in restaurant["cuisines"] or "Coffee" in restaurant["foods"]
    )
    breakfast_kids = sum(1 for restaurant in kids if "Breakfast" in restaurant["meals"])
    seafood_kids = sum(1 for restaurant in kids if SEAFOOD_CUISINE in restaurant["cuisines"])
    dinner_kids = sum(1 for restaurant in dinner if restaurant["kids"])
    rosemary_breakfast = sum(1 for restaurant in rosemary if "Breakfast" in restaurant["meals"])
    rosemary_dinner = sum(1 for restaurant in rosemary if "Dinner" in restaurant["meals"])
    rosemary_seafood = sum(1 for restaurant in rosemary if SEAFOOD_CUISINE in restaurant["cuisines"])
    watercolor_breakfast = sum(1 for restaurant in watercolor if "Breakfast" in restaurant["meals"])
    watercolor_water = [restaurant for restaurant in watercolor if "Waterfront" in restaurant["vibes"]]
    if not watercolor_water:
        raise SystemExit("WaterColor guide expected a waterfront listing")
    favorite_seafood = sum(1 for restaurant in favorites if SEAFOOD_CUISINE in restaurant["cuisines"])
    favorite_kids = sum(1 for restaurant in favorites if restaurant["kids"])
    cafe_breakfast = sum(1 for restaurant in cafes if "Breakfast" in restaurant["meals"])
    cafe_coffee = sum(1 for restaurant in cafes if "Coffee" in restaurant["foods"])
    walk_counts = []
    for slug in WALKABLE_AREAS:
        area = area_record(areas, slug)
        count = sum(1 for restaurant in walkable if restaurant["areaSlug"] == slug)
        walk_counts.append(f"{count} in {area['fullName']}")
    town_center = sum(1 for restaurant in walkable if restaurant["subarea"] == "Town Center")
    origins_center = sum(
        1
        for restaurant in restaurants
        if restaurant["areaSlug"] == "watersound-origins" and restaurant["subarea"] == "Town Center"
    )
    breakfast_groups, breakfast_ranked = rank_areas(breakfast, areas)
    breakfast_towns = {restaurant["areaSlug"] for restaurant in breakfast}
    breakfast_missing = [area["fullName"] for area in areas if area["slug"] not in breakfast_towns]
    cafe_groups, cafe_ranked = rank_areas(cafes, areas)
    cafe_not_breakfast = [restaurant for restaurant in cafes if "Breakfast" not in restaurant["meals"]]
    rosemary_cafes = [restaurant for restaurant in cafes if restaurant["areaSlug"] == "rosemary-beach"]
    kids_groups, kids_ranked = rank_areas(kids, areas)
    seafood_groups, seafood_ranked = rank_areas(seafood, areas)
    dinner_row = [restaurant for restaurant in dinner if restaurant["subarea"] == "Airstream Row"]
    dinner_center = [restaurant for restaurant in dinner if restaurant["subarea"] == "Town Center"]
    dinner_not_kids = [restaurant for restaurant in dinner if not restaurant["kids"]]
    seaside_other = [restaurant for restaurant in seaside if "Dinner" not in restaurant["meals"]]
    rosemary_seafood_rows = [restaurant for restaurant in rosemary if SEAFOOD_CUISINE in restaurant["cuisines"]]
    rosemary_point = [restaurant for restaurant in rosemary if restaurant["subarea"]]
    watercolor_breakfast_rows = [restaurant for restaurant in watercolor if "Breakfast" in restaurant["meals"]]
    fav_seafood_rows = [restaurant for restaurant in favorites if SEAFOOD_CUISINE in restaurant["cuisines"]]
    fav_other = [restaurant for restaurant in favorites if SEAFOOD_CUISINE not in restaurant["cuisines"]]
    fav_kids_rows = [restaurant for restaurant in favorites if restaurant["kids"]]
    fav_not_kids = [restaurant for restaurant in favorites if not restaurant["kids"]]
    fav_multi = [(area, group) for area, group in area_groups(favorites, areas) if len(group) > 1]

    watercolor_coffee = [
        restaurant
        for restaurant in watercolor
        if "Cafe" in restaurant["cuisines"] or "Coffee" in restaurant["foods"]
    ]
    if len(watercolor_coffee) == 1:
        spot = watercolor_coffee[0]
        tags = []
        if "Cafe" in spot["cuisines"]:
            tags.append("Cafe")
        if "Coffee" in spot["foods"]:
            tags.append("Coffee")
        watercolor_coffee_answer = f"{spot['name']} is the coffee stop in WaterColor."
    elif watercolor_coffee:
        watercolor_coffee_answer = f"{name_list(watercolor_coffee)} are tagged Cafe or Coffee."
    else:
        watercolor_coffee_answer = "None of the WaterColor restaurants are tagged Cafe or Coffee."
    seafood_count = len(seafood)
    seafood_word = restaurant_count_word(seafood_count)
    specs = [
        guide_spec(
            "best-seafood-30a",
            "Best seafood on 30A",
            SEAFOOD_GUIDE_TITLE,
            SEAFOOD_GUIDE_DESCRIPTION,
            "Seafood",
            [
                "Looking for the best seafood along Scenic Highway 30A in South Walton, Florida? This guide brings together seafood restaurants, oyster bars, raw bars, fish markets, and casual Gulf Coast favorites located along 30A and nearby communities, organized from west to east so it’s easy to plan your stops as you explore the coast.",
                "Seafood on 30A ranges from laid-back spots serving fried shrimp baskets, fish tacos, and oysters to waterfront restaurants, seafood markets, and more upscale dining featuring fresh fish, crab, shrimp, and other Gulf-inspired dishes. Whether you’re looking for a quick lunch after the beach, oysters and cocktails in the afternoon, fresh seafood to take back to your rental, or a full dinner out, this guide is designed to help you narrow down the options.",
                "Use the listings to compare restaurants as you travel through the 30A area, then open any restaurant card for its location, hours, and additional details. You can also use the directory or map with the Seafood filter selected to see which options are closest to where you’re staying.",
                "A few tips before you go: hours can change seasonally, and some popular 30A seafood restaurants can become very busy during spring break, summer, holidays, and weekends. Check current hours before making the drive, consider reservations when they’re offered, and remember that parking can be limited in some beach communities. If you’re staying in a vacation rental, don’t overlook the local seafood markets either—they can be a great option for fresh fish, steamed shrimp, prepared seafood, and an easy dinner at home.",
                "From casual Gulf seafood to oysters, fresh catch, and seafood markets, this guide is a good starting point for finding seafood restaurants along Scenic Highway 30A and throughout South Walton.",
            ],
            seafood,
            seafood_href,
            seafood_map,
            seafood_faq(seafood, areas),
            "Seafood",
            "Oyster bars, raw bars, markets, and sit-down seafood along 30A.",
            teaser_image(seafood, areas),
            "Seafood restaurants along Scenic Highway 30A.",
            extra=[(filter_href("/restaurants/", [("cuisine", "Seafood"), ("kids", "yes")]), "Kid-friendly seafood")],
            extra_label="Seafood filters",
            list_name="Seafood restaurants on 30A",
        ),
        guide_spec(
            "breakfast-30a",
            "Breakfast on 30A",
            "Breakfast on 30A | Eating on 30A",
            (
                "Breakfast restaurants on Scenic Highway 30A in Walton County, Florida, "
                "from Gulf Place to Inlet Beach, with the directory and a map for the morning."
            ),
            "Breakfast",
            [
                (
                    f"Breakfast along Scenic Highway 30A reaches from {breakfast_groups[0][0]['fullName']} — "
                    f"{name_list(breakfast_groups[0][1])} — to {breakfast_groups[-1][0]['fullName']}, "
                    f"where you’ll find {name_list(breakfast_groups[-1][1])}. "
                    f"{widest_choice(breakfast_groups, breakfast_ranked)}. "
                    "If you’re eating before a beach day, start with those towns."
                ),
                "A lot of the morning spots also pour coffee or bake. For a cafe, a donut shop, or a later start, use the coffee guide.",
                (
                    f"Staying in {or_list(breakfast_missing)}? Plan a short drive. "
                    "Those communities don’t have a breakfast restaurant, so you’ll be heading to a neighbor — "
                    "Gulf Place, Seagrove Beach, Seaside, or Rosemary Beach, depending on which part of 30A you’re on."
                    if breakfast_missing
                    else "Every town along 30A has at least one breakfast restaurant."
                ),
                "Open a card for the address and the hours. If you already know your beach town, the directory and the map can show breakfast on its own, or breakfast together with kid friendly.",
                "Summer weekends and holidays are when the morning rooms fill up, and hours shift outside peak season. Check the card before you drive across the highway, and eat before the beach if you can.",
            ],
            breakfast,
            breakfast_href,
            breakfast_map,
            [
                faq_item(
                    "Where along 30A can I get breakfast?",
                    (
                        f"{widest_choice(breakfast_groups, breakfast_ranked)}. "
                        f"In {breakfast_groups[0][0]['fullName']}, look for {name_list(breakfast_groups[0][1])}. "
                        f"In {breakfast_groups[-1][0]['fullName']}, look for {name_list(breakfast_groups[-1][1])}."
                    ),
                    breakfast_href,
                    "See breakfast in the directory",
                ),
                faq_item(
                    "Which 30A towns don’t have breakfast?",
                    (
                        f"None in {or_list(breakfast_missing)}. Plan a short drive to a neighboring town."
                        if breakfast_missing
                        else "Every town along 30A has at least one breakfast restaurant."
                    ),
                    breakfast_href,
                    "Show the breakfast list",
                ),
                faq_item(
                    "Can I get coffee with breakfast?",
                    "Yes. A lot of breakfast places also pour coffee or bake. Cafes, donut shops, and a later morning are on the coffee guide.",
                    "/guides/coffee-brunch-30a/",
                    "Open coffee and brunch",
                ),
            ],
            "Breakfast",
            f"Morning along 30A. {widest_choice(breakfast_groups, breakfast_ranked)}.",
            teaser_image(breakfast, areas),
            "Breakfast restaurants along Scenic Highway 30A.",
            list_name="Breakfast on 30A",
        ),
        guide_spec(
            "coffee-brunch-30a",
            "Coffee and brunch on 30A",
            "Coffee and brunch on 30A | Eating on 30A",
            (
                "Coffee and cafes on Scenic Highway 30A in Walton County, Florida, for a late breakfast or coffee. "
                "There isn’t a separate brunch category."
            ),
            "Coffee",
            [
                (
                    "Looking for coffee or a late breakfast on Scenic Highway 30A? "
                    "30A doesn’t have brunch as its own meal. Bakeries, donut shops, coffee roasters, and breakfast cafes are the places to go."
                ),
                (
                    f"{cafe_groups[0][1][0]['name']} in {cafe_groups[0][0]['fullName']} is an easy coffee stop before Grayton Beach. "
                    f"{widest_choice(cafe_groups, cafe_ranked)}. "
                    + (
                        f"In Rosemary Beach, start with {name_list(rosemary_cafes[:3])}. "
                        if rosemary_cafes
                        else ""
                    )
                    + (
                        "Amavida has a shop in Seaside and another in Rosemary Beach."
                        if sum(1 for restaurant in cafes if "Amavida" in restaurant["name"]) >= 2
                        else ""
                    )
                ),
                (
                    "Most of these cafes also serve breakfast. "
                    + (
                        f"These don’t: {human_list([place_phrase(restaurant) for restaurant in cafe_not_breakfast])}. "
                        "Check the card so you don’t arrive for breakfast at a lunch spot."
                        if cafe_not_breakfast
                        else "If you want a full morning menu, the breakfast guide is the wider list."
                    )
                ),
                "Open a card for hours. The directory and the map can show just the cafes, which is the simplest way to see coffee near the town you’re staying in.",
                "Donut and coffee shops are the quick stop on the way to the sand. A sit-down cafe is the better plan when you want an actual breakfast. Hours shrink outside summer, and the busy Seagrove shops get a line on weekend mornings.",
            ],
            cafes,
            cafe_href,
            cafe_map,
            [
                faq_item(
                    "Is there brunch on 30A?",
                    (
                        "Not as its own meal. Breakfast, lunch, and dinner are what the guide lists. "
                        "Coffee, bakeries, and a late breakfast are here with the cafes."
                    ),
                    cafe_href,
                    "See cafes in the directory",
                ),
                faq_item(
                    "Where along 30A is the coffee?",
                    (
                        f"{cafe_groups[0][1][0]['name']} in {cafe_groups[0][0]['fullName']} is one place to start. "
                        f"{widest_choice(cafe_groups, cafe_ranked)}. "
                        + (
                            f"In Rosemary Beach, try {name_list(rosemary_cafes[:3])}."
                            if len(rosemary_cafes) >= 1
                            else ""
                        )
                    ),
                    cafe_href,
                    "See them in the directory",
                ),
                faq_item(
                    "Do these cafes serve breakfast?",
                    (
                        "Most of them do. "
                        f"These don’t: {human_list([place_phrase(restaurant) for restaurant in cafe_not_breakfast])}."
                        if cafe_not_breakfast
                        else "Yes. The cafes here also cover breakfast."
                    ),
                    breakfast_href,
                    "Show breakfast",
                ),
            ],
            "Coffee",
            "Cafes, coffee, and a late breakfast. 30A doesn’t have brunch as its own meal.",
            teaser_image(cafes, areas),
            "Cafes and coffee along Scenic Highway 30A. There isn’t a separate brunch category.",
            list_name="Coffee and cafes on 30A",
        ),
        guide_spec(
            "kid-friendly-30a",
            "Kid-friendly on 30A",
            "Kid-friendly on 30A | Eating on 30A",
            (
                "Kid-friendly restaurants on Scenic Highway 30A in Walton County, Florida, "
                "for families eating from Dune Allen Beach through Watersound Origins."
            ),
            "With kids",
            [
                (
                    "Scenic Highway 30A is an easy place to eat with kids. "
                    f"You’ll find family-friendly rooms from {kids_groups[0][0]['fullName']} through {kids_groups[-1][0]['fullName']}. "
                    f"{widest_choice(kids_groups, kids_ranked)}."
                ),
                "You don’t have to give up the meal you wanted. Breakfast and seafood both show up here. If the full set feels like too much, narrow it to kid-friendly breakfast or kid-friendly seafood in the directory.",
                "Not every restaurant on 30A is a family stop. If a place isn’t on this page, it isn’t listed as kid friendly. Open the card before you promise the kids a table.",
                "Lunch after the beach is usually kinder than a late dinner with tired children. Seaside and Rosemary Beach get crowded on summer evenings, so an earlier meal is the easier plan. The guide doesn’t list high chairs, so call ahead if you need one.",
            ],
            kids,
            kids_href,
            kids_map,
            [
                faq_item(
                    "Is every restaurant on 30A kid friendly?",
                    "No. If a restaurant isn’t on this page, it isn’t listed as kid friendly. Check the card before you count on it with children.",
                    kids_href,
                    "Show the kid-friendly list",
                ),
                faq_item(
                    "Which towns have the most kid-friendly restaurants?",
                    (
                        f"{widest_choice(kids_groups, kids_ranked)}. "
                        f"You’ll still find options from {kids_groups[0][0]['fullName']} through {kids_groups[-1][0]['fullName']}."
                    ),
                    kids_href,
                    "See them in the directory",
                ),
                faq_item(
                    "Can we do breakfast or seafood with kids?",
                    "Yes. Both breakfast and seafood include kid-friendly restaurants. The directory can show those two meals with the kid-friendly filter on.",
                    filter_href("/restaurants/", [("cuisine", "Seafood"), ("kids", "yes")]),
                    "Show kid-friendly seafood",
                ),
            ],
            "Kid friendly",
            f"Family meals along 30A. {widest_choice(kids_groups, kids_ranked)}.",
            teaser_image(kids, areas),
            "Kid-friendly restaurants along Scenic Highway 30A.",
            list_name="Kid-friendly restaurants on 30A",
        ),
        guide_spec(
            "dinner-seaside",
            "Dinner in Seaside",
            "Dinner in Seaside on 30A | Eating on 30A",
            (
                "Dinner in Seaside on Scenic Highway 30A in Walton County, Florida, "
                "including Town Center, Airstream Row, and the waterfront."
            ),
            "Seaside",
            [
                (
                    "Dinner in Seaside is a walk around town more than a drive down 30A. "
                    "You’ll find it in Town Center, along Airstream Row, and in the rest of Seaside"
                    + (
                        f", including on the water at {name_list([restaurant for restaurant in dinner if 'Waterfront' in restaurant['vibes']])}."
                        if any("Waterfront" in restaurant["vibes"] for restaurant in dinner)
                        else "."
                    )
                ),
                (
                    (
                        f"In Town Center, dinner is {name_list(dinner_center)}. "
                        if dinner_center
                        else ""
                    )
                    + "Airstream Row is the casual stretch — barbecue, crepes, sandwiches, and the like — mixed in with restaurants elsewhere in town."
                ),
                (
                    (
                        f"Not everything in Seaside is a dinner restaurant. {name_list(seaside_other)} cover coffee, a snack, dessert, or the market. "
                        "They’re on the Seaside town page if you want them during the day."
                        if seaside_other
                        else "The Seaside town page still has the full set of restaurants, including daytime stops."
                    )
                ),
                (
                    "Most Seaside dinners are fine with kids. "
                    + (
                        f"{name_list(dinner_not_kids)} "
                        f"{'isn’t' if len(dinner_not_kids) == 1 else 'aren’t'} listed as kid friendly."
                        if dinner_not_kids
                        else "The dinners here are kid friendly."
                    )
                ),
                "Seaside parking tightens up in spring break, summer, and on weekends. If you’re staying in town, Town Center and Airstream Row are the easy loops on foot. Waterfront tables get busy — check the hours on the card and go a little early if Bud & Alley’s is the plan.",
            ],
            dinner,
            dinner_href,
            dinner_map,
            [
                faq_item(
                    "Does every Seaside restaurant serve dinner?",
                    (
                        f"No. {name_list(seaside_other)} are the ones for coffee, a snack, dessert, or the market. "
                        "The town page has the full Seaside list."
                        if seaside_other
                        else "Yes. The Seaside restaurants here all serve dinner."
                    ),
                    "/areas/seaside/",
                    "Open the Seaside town page",
                ),
                faq_item(
                    "Where in Seaside is dinner?",
                    (
                        (
                            f"Town Center: {name_list(dinner_center)}. "
                            if dinner_center
                            else ""
                        )
                        + (
                            "Airstream Row is the casual row. "
                            if dinner_row
                            else ""
                        )
                        + (
                            "On the water: "
                            + name_list([restaurant for restaurant in dinner if "Waterfront" in restaurant["vibes"]])
                            + "."
                            if any("Waterfront" in restaurant["vibes"] for restaurant in dinner)
                            else "The rest are scattered through town."
                        )
                    ).strip(),
                    dinner_href,
                    "See dinner in the directory",
                ),
                faq_item(
                    "Can we bring kids to dinner in Seaside?",
                    (
                        f"Most yes. {name_list(dinner_not_kids)} "
                        f"{'isn’t' if len(dinner_not_kids) == 1 else 'aren’t'} listed as kid friendly."
                        if dinner_not_kids
                        else "Yes. The Seaside dinners here are kid friendly."
                    ),
                    filter_href("/restaurants/", [("area", "seaside"), ("meal", "Dinner"), ("kids", "yes")]),
                    "Show kid-friendly dinner in Seaside",
                ),
            ],
            "Seaside",
            "Evening in Seaside: Town Center, Airstream Row, and the waterfront.",
            teaser_image(dinner, areas, "seaside"),
            "Dinner restaurants in Seaside on Scenic Highway 30A.",
            extra=[("/areas/seaside/", "Seaside town page")],
            list_name="Dinner in Seaside",
        ),
        guide_spec(
            "rosemary-beach-restaurants",
            "Rosemary Beach restaurants",
            "Rosemary Beach restaurants | Eating on 30A",
            (
                "Rosemary Beach restaurants on Scenic Highway 30A in Walton County, Florida, "
                "the cobblestone town east of Alys Beach, with breakfast, dinner, and seafood."
            ),
            "Rosemary Beach",
            [
                "Rosemary Beach is the cobblestone town just east of Alys Beach, and it’s an easy place to park once and walk to dinner. The restaurants here cover morning cafes, a real dinner selection, and seafood if that’s the meal you came for.",
                (
                    "For breakfast, look at "
                    + name_list([restaurant for restaurant in rosemary if "Breakfast" in restaurant["meals"]])
                    + ". Seafood is "
                    + name_list(rosemary_seafood_rows)
                    + "."
                    + (
                        f" {name_list(rosemary_point)} {'is' if len(rosemary_point) == 1 else 'are'} up in {rosemary_point[0]['subarea']}; the others are in town."
                        if rosemary_point and len({restaurant['subarea'] for restaurant in rosemary_point}) == 1
                        else ""
                    )
                ),
                "Pescado, the rooftop, is one of Lauren’s Favorites if you want a shorter shortlist inside town. The town page is where to read about Rosemary Beach itself; this page is for choosing the meal.",
                "The streets are cobblestone, so real shoes beat beach flip-flops after dark. Hours move with the season. Rosemary isn’t a stroll from Seaside or WaterColor — drive over, park once, and stay for the evening.",
            ],
            rosemary,
            rosemary_href,
            rosemary_map,
            [
                faq_item(
                    "What can I eat in Rosemary Beach?",
                    (
                        "Breakfast at the cafes, dinner through the evening, and seafood at "
                        + name_list(rosemary_seafood_rows)
                        + "."
                    ),
                    filter_href("/restaurants/", [("area", "rosemary-beach"), ("cuisine", "Seafood")]),
                    "Show Rosemary Beach seafood",
                ),
                faq_item(
                    "Is this the same list as the town page?",
                    "Same restaurants. The town page tells you about Rosemary Beach. Here you can open the directory or the map with the town already selected.",
                    rosemary_href,
                    "See them in the directory",
                ),
                faq_item(
                    "Where does Rosemary Beach sit on 30A?",
                    "Just east of Alys Beach and west of Inlet Beach. It’s a drive from Seaside, not a walk, and it’s the cobblestone town if you want to park once for the evening.",
                    "/guides/walkable-30a/",
                    "See the walkable towns",
                ),
            ],
            "Rosemary Beach",
            "The cobblestone town east of Alys Beach: breakfast, dinner, and seafood.",
            teaser_image(rosemary, areas, "rosemary-beach"),
            "Restaurants in Rosemary Beach on Scenic Highway 30A.",
            extra=[("/areas/rosemary-beach/", "Rosemary Beach town page")],
            list_name="Rosemary Beach restaurants",
        ),
        guide_spec(
            "watercolor-restaurants",
            "WaterColor restaurants",
            "WaterColor restaurants on 30A | Eating on 30A",
            (
                "WaterColor restaurant guide for Scenic Highway 30A in Walton County, Florida, "
                "with every listing in town, the directory, and the map."
            ),
            "WaterColor",
            [
                "WaterColor sits between Grayton Beach and Seaside, and the dining list is short enough to decide from. You can do breakfast in town and a dressed-up dinner without leaving the community.",
                (
                    f"Breakfast is {name_list(watercolor_breakfast_rows)}. "
                    "For the evening, add "
                    + name_list([restaurant for restaurant in watercolor if "Dinner" in restaurant["meals"] and restaurant not in watercolor_breakfast_rows])
                    + ", plus The Perfect Pig if you want a place that covers both."
                    if any(restaurant["name"] == "The Perfect Pig" for restaurant in watercolor)
                    else "."
                ),
                (
                    f"{watercolor_water[0]['name']} is the waterfront restaurant"
                    + (
                        f" at the {watercolor_water[0]['subarea']}"
                        if watercolor_water[0]["subarea"]
                        else ""
                    )
                    + " — the dressed-up seafood meal, and one of Lauren’s Favorites. "
                    f"{watercolor_coffee[0]['name']} is where you get coffee."
                    if watercolor_coffee
                    else "Beach coffee means a short hop to a neighboring town."
                ),
                "If you’re staying at the inn, Fish Out of Water is the on-property choice. Scratch Biscuit Kitchen, Beach Happy Cafe, and Pizza by the Sea are the more casual stops. The Wine Bar is the later glass. Breakfast isn’t an all-day service, so check the hours on the card before you walk over.",
            ],
            watercolor,
            watercolor_href,
            watercolor_map,
            [
                faq_item(
                    "Is WaterColor only a breakfast stop?",
                    (
                        "No. Dinner is "
                        + name_list([restaurant for restaurant in watercolor if "Dinner" in restaurant["meals"]])
                        + ". Breakfast is "
                        + name_list(watercolor_breakfast_rows)
                        + "."
                    ),
                    filter_href("/restaurants/", [("area", "watercolor"), ("meal", "Breakfast")]),
                    "Show WaterColor breakfast",
                ),
                faq_item(
                    "Which WaterColor restaurant is on the water?",
                    (
                        f"{name_list(watercolor_water)} "
                        + (
                            f"is on the water"
                            + (
                                f", at the {watercolor_water[0]['subarea']}."
                                if len(watercolor_water) == 1 and watercolor_water[0]["subarea"]
                                else "."
                            )
                            if len(watercolor_water) == 1
                            else "are on the water."
                        )
                    ),
                    watercolor_href,
                    "See WaterColor in the directory",
                ),
                faq_item(
                    "Is there coffee in WaterColor?",
                    watercolor_coffee_answer,
                    "/guides/coffee-brunch-30a/",
                    "See coffee and cafes on 30A",
                ),
            ],
            "WaterColor",
            f"Between Grayton Beach and Seaside: breakfast in town and {watercolor_water[0]['name']} on the water.",
            teaser_image(watercolor, areas, "watercolor"),
            "Restaurants in WaterColor on Scenic Highway 30A.",
            extra=[("/areas/watercolor/", "WaterColor town page")],
            list_name="WaterColor restaurants",
        ),
        guide_spec(
            "walkable-30a",
            "Walkable restaurants on 30A",
            "Walkable restaurants on 30A | Eating on 30A",
            (
                "Restaurants you can walk to in Seaside, Alys Beach, and Rosemary Beach "
                "on Scenic Highway 30A in Walton County, Florida."
            ),
            "On foot",
            [
                "Want to park the car and walk to dinner? On Scenic Highway 30A, the towns where people actually do that are Seaside, Alys Beach, and Rosemary Beach. This page is every restaurant in those three.",
                "The guide doesn’t score a restaurant as walkable, so treat this as a town shortcut, not a rating. Seaside’s own town note calls it walkable. Rosemary Beach is cobblestone, built around streets you can cross on foot. Alys Beach is here because the streets are laid out for walking between restaurants, not because a listing says so.",
                "They are not one continuous stroll. Seaside, Alys Beach, and Rosemary Beach are separate stops along the highway. Open one town in the directory or on the map, then switch when you move.",
                "Town Center isn’t the same idea. It’s a neighborhood name, and the Seaside restaurants that use it are on this page. Watersound Origins, north of 30A, has its own town center; those restaurants stay on the Origins page.",
                "Pick one town for the evening. Seaside is the busiest on foot in summer. Rosemary’s cobblestones are charming and a little uneven after dark. Don’t plan to walk from Seaside to Rosemary.",
            ],
            walkable,
            "/restaurants/?area=seaside",
            "/map/?area=seaside",
            [
                faq_item(
                    "Are the three towns one walk?",
                    (
                        "No. They’re separate stops along the highway, and the directory and the map open one town at a time. "
                        "Don’t plan to stroll from Seaside to Rosemary Beach."
                    ),
                    "/restaurants/?area=seaside",
                    "Open Seaside in the directory",
                ),
                faq_item(
                    "Is Town Center the same as walkable?",
                    (
                        "No. Town Center is a neighborhood in Seaside, not a walk score. "
                        "Watersound Origins, north of 30A, has its own town center, and those restaurants stay on that town page."
                    ),
                    "/areas/watersound-origins/",
                    "Open Watersound Origins",
                ),
                faq_item(
                    "How do I map one of these towns?",
                    "One town at a time. Start with Seaside, then switch the town control to Alys Beach or Rosemary Beach.",
                    "/map/?area=seaside",
                    "Open the Seaside map",
                ),
            ],
            "Walkable",
            "Park once in Seaside, Alys Beach, or Rosemary Beach.",
            teaser_image(walkable, areas, "seaside"),
            "Restaurants in Seaside, Alys Beach, and Rosemary Beach for a night you can walk.",
            extra=[
                ("/restaurants/?area=rosemary-beach", "Rosemary Beach in the directory"),
                ("/map/?area=rosemary-beach", "Map Rosemary Beach"),
                ("/restaurants/?area=alys-beach", "Alys Beach in the directory"),
                ("/map/?area=alys-beach", "Map Alys Beach"),
            ],
            directory_label="Seaside in the directory",
            map_label="Map Seaside",
            list_name="Walkable restaurants on 30A",
        ),
        guide_spec(
            "laurens-favorites-30a",
            "Lauren’s Favorites on 30A",
            "Lauren’s Favorites on 30A | Eating on 30A",
            (
                "Lauren’s Favorites on Scenic Highway 30A in Walton County, Florida, "
                "her short list from Blue Mountain Beach to Rosemary Beach, with a map."
            ),
            "Favorites",
            [
                (
                    "When you don’t want to sort the whole highway, start with Lauren’s Favorites. "
                    f"They’re her short list: {human_list([place_phrase(restaurant) for restaurant in favorites])}."
                ),
                (
                    (
                        f"The seafood meals are {name_list(fav_seafood_rows)}. "
                        if fav_seafood_rows
                        else ""
                    )
                    + (
                        human_list(
                            [
                                (
                                    f"{restaurant['name']} is Italian in {restaurant['area']}"
                                    if "Italian" in restaurant["cuisines"]
                                    else (
                                        f"{restaurant['name']} is the cafe stop in {restaurant['area']}"
                                        if "Cafe" in restaurant["cuisines"]
                                        else f"{restaurant['name']} in {restaurant['area']} is a different kind of meal"
                                    )
                                )
                                for restaurant in fav_other
                            ]
                        )
                        + "."
                        if fav_other
                        else "The favorites here are seafood."
                    )
                    + (
                        f" In {fav_multi[0][0]['fullName']}, {name_list(fav_multi[0][1])} are both on the list."
                        if len(fav_multi) == 1
                        else ""
                    )
                ),
                (
                    (
                        f"{name_list(fav_kids_rows)} are kid friendly. "
                        f"{name_list(fav_not_kids)} {'isn’t' if len(fav_not_kids) == 1 else 'aren’t'}."
                        if fav_kids_rows and fav_not_kids
                        else "Check each card if you’re bringing children."
                    )
                ),
                "This is a short list, not a ranking of every good meal on 30A. Hours live on the card. If you want more in the same town, open that town’s page after you’ve looked at Lauren’s pick.",
            ],
            favorites,
            favorites_href,
            favorites_map,
            [
                faq_item(
                    "Where are Lauren’s Favorites on 30A?",
                    f"They’re spread along the highway: {human_list([place_phrase(restaurant) for restaurant in favorites])}.",
                    favorites_href,
                    "See them in the directory",
                ),
                faq_item(
                    "Are Lauren’s Favorites all seafood?",
                    (
                        f"The seafood ones are {name_list(fav_seafood_rows)}. "
                        f"{name_list(fav_other)} {'isn’t' if len(fav_other) == 1 else 'aren’t'}."
                        if fav_other and fav_seafood_rows
                        else (
                            "Yes. These favorites are seafood."
                            if not fav_other
                            else f"None of them are seafood. The list is {name_list(favorites)}."
                        )
                    ),
                    favorites_href,
                    "Show Lauren’s Favorites",
                ),
                faq_item(
                    "Which of Lauren’s Favorites are kid friendly?",
                    (
                        f"{name_list(fav_kids_rows)} are. "
                        f"{name_list(fav_not_kids)} {'isn’t' if len(fav_not_kids) == 1 else 'aren’t'}."
                        if fav_kids_rows and fav_not_kids
                        else (
                            "All of them are."
                            if not fav_not_kids
                            else "None of them are."
                        )
                    ),
                    filter_href("/restaurants/", [("laurensFavorite", "yes"), ("kids", "yes")]),
                    "Show kid-friendly favorites",
                ),
            ],
            "Favorites",
            "Lauren’s short list, from Blue Mountain Beach to Rosemary Beach.",
            teaser_image(favorites, areas),
            "Restaurants marked Lauren’s Favorites on Scenic Highway 30A.",
            list_name="Lauren’s Favorites on 30A",
        ),
    ]
    for spec in specs:
        require_meta(spec["title"], spec["description"])
        if not 2 <= len(spec["faqs"]) <= 4:
            raise SystemExit(f"{spec['slug']} needs 2 to 4 FAQ questions, got {len(spec['faqs'])}")
    return specs


def write_guide_page(spec: dict) -> None:
    cards = "".join(card(restaurant) for restaurant in spec["restaurants"])
    extra = ""
    if spec["extra"]:
        extra = (
            f'<nav class="section-links" aria-label="{e(spec["extra_label"])}">'
            + "".join(text_link(href, label) for href, label in spec["extra"])
            + "</nav>"
        )
    body = (
        '<article class="profile">'
        '<div class="profile-hero">'
        f'<img src="{e(HERO_IMAGE)}" alt="{e(HERO_ALT)}" loading="eager">'
        "</div>"
        '<div class="wrap page-intro">'
        '<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> '
        f'<a href="/guides/">Guides</a> <span aria-hidden="true">/</span> {e(spec["h1"])}</p>'
        f'<p class="kicker">{e(spec["kicker"])}</p>'
        f'<h1 class="guide-title">{e(spec["h1"])}</h1>'
        + "".join(f'<p class="lede">{e(paragraph)}</p>' for paragraph in spec["paragraphs"])
        + f'<p class="action-row"><a class="button" href="{e(spec["directory_href"])}">{e(spec["directory_label"])}</a> '
        f'<a class="button secondary" href="{e(spec["map_href"])}">{e(spec["map_label"])}</a></p>'
        f"{extra}"
        f'<div class="card-grid">{cards}</div>'
        f"{faq_html(spec['faqs'])}"
        "</div></article>"
    )
    write(
        ROOT / "guides" / spec["slug"] / "index.html",
        layout(
            spec["title"],
            spec["description"],
            spec["path"],
            "guides",
            body,
            json_ld(
                graph(
                    {
                        "@type": "CollectionPage",
                        "name": spec["h1"],
                        "headline": spec["h1"],
                        "url": ORIGIN + spec["path"],
                        "description": spec["description"],
                        "isPartOf": {"@id": ORIGIN + "/#website"},
                    },
                    {
                        "@type": "ItemList",
                        "name": spec["list_name"],
                        "numberOfItems": len(spec["restaurants"]),
                        "itemListElement": [
                            {
                                "@type": "ListItem",
                                "position": index,
                                "name": restaurant["name"],
                                "url": f"{ORIGIN}/restaurants/{restaurant['slug']}/",
                            }
                            for index, restaurant in enumerate(spec["restaurants"], start=1)
                        ],
                    },
                    faq_nodes(spec["faqs"]),
                    breadcrumbs([("Home", "/"), ("Guides", "/guides/"), (spec["h1"], spec["path"])]),
                )
            ),
            image=HERO_IMAGE,
            image_alt=HERO_ALT,
        ),
    )


def build_guides(restaurants: list[dict], areas: list[dict]) -> list[dict]:
    require_meta(GUIDES_INDEX_TITLE, GUIDES_INDEX_DESCRIPTION)
    specs = guide_picks(restaurants, areas)
    for spec in specs:
        write_guide_page(spec)
    teasers = "".join(
        guide_teaser(
            spec["h1"],
            spec["path"],
            spec["teaser_area"],
            f"{len(spec['restaurants'])} {restaurant_count_word(len(spec['restaurants']))}",
            spec["teaser_note"],
            spec["teaser_image"],
            spec["teaser_alt"],
        )
        for spec in specs
    )
    index_body = (
        '<div class="wrap page-intro">'
        '<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> Guides</p>'
        '<p class="kicker">For the trip</p>'
        "<h1>Guides along 30A</h1>"
        f'<div class="card-grid">{teasers}</div></div>'
    )
    write(
        ROOT / "guides" / "index.html",
        layout(
            GUIDES_INDEX_TITLE,
            GUIDES_INDEX_DESCRIPTION,
            "/guides/",
            "guides",
            index_body,
            json_ld(
                graph(
                    {
                        "@type": "CollectionPage",
                        "name": "Guides along 30A",
                        "url": ORIGIN + "/guides/",
                        "description": GUIDES_INDEX_DESCRIPTION,
                        "isPartOf": {"@id": ORIGIN + "/#website"},
                    },
                    {
                        "@type": "ItemList",
                        "name": "Guides",
                        "numberOfItems": len(specs),
                        "itemListElement": [
                            {
                                "@type": "ListItem",
                                "position": index,
                                "name": spec["h1"],
                                "url": ORIGIN + spec["path"],
                            }
                            for index, spec in enumerate(specs, start=1)
                        ],
                    },
                    breadcrumbs([("Home", "/"), ("Guides", "/guides/")]),
                )
            ),
            image=HERO_IMAGE,
            image_alt=HERO_ALT,
        ),
    )
    return specs
def build_about() -> None:
    covers = "".join(print_cover(path, alt) for path, alt in PRINT_COVERS)
    body = (
        '<div class="wrap page-intro">'
        '<div class="about-lead"><div class="prose">'
        '<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> About</p>'
        '<p class="kicker">About</p>'
        "<h1>The 30A restaurant guide</h1>"
        f"<p>{e(ABOUT_LEAD)}</p>"
        f"<p>{e(ABOUT_TOWNS)}</p>"
        '<p><a class="button" href="/restaurants/">See the restaurants</a></p></div>'
        '<aside class="window-decal" aria-labelledby="window-decal-heading">'
        f'<img src="{e(WINDOW_DECAL_IMAGE)}" width="900" height="900" alt="{e(WINDOW_DECAL_ALT)}">'
        '<div class="window-decal-copy">'
        '<p class="kicker">For restaurants</p>'
        '<h2 id="window-decal-heading">A free window decal</h2>'
        "<p>If you run a restaurant on 30A, we’ll send a free decal for the front window. "
        f'Please <a class="text-link" href="{e(window_decal_href())}">contact us</a> '
        "and include the restaurant name.</p>"
        "</div></aside></div>"
        '<section class="print-guides" aria-labelledby="print-guides-heading">'
        '<div class="prose"><h2 id="print-guides-heading">Coming in 2027</h2>'
        f"<p>{e(PRINT_GUIDES)}</p>"
        '<p>For information or to reserve your space, please <a class="text-link" href="/contact/">contact us</a>.</p></div>'
        f'<div class="print-covers">{covers}</div>'
        "</section></div>"
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
        '<div class="wrap page-intro">'
        '<div class="prose">'
        '<p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> Contact</p>'
        '<p class="kicker">Contact</p>'
        "<h1>Corrections and new listings</h1>"
        "<p>Restaurant hours, phone numbers, websites, and other details are listed on each restaurant page. "
        "If something needs to be updated, a restaurant has closed, or we’re missing a place you think should be included, let us know.</p>"
        "<p>Just include the restaurant name and what needs to be changed or added. "
        "We review every submission and can follow up using the email address you provide.</p></div>"
        '<form class="listing-form" action="/api/listing" method="post" data-listing>'
        "<label><span>Your name <abbr title=\"required\">*</abbr></span>"
        '<input name="name" type="text" required maxlength="120" autocomplete="name"></label>'
        "<label><span>Email <abbr title=\"required\">*</abbr></span>"
        '<input name="email" type="email" required maxlength="200" autocomplete="email" inputmode="email"></label>'
        "<label><span>Restaurant name</span>"
        '<input name="restaurant" type="text" maxlength="160" autocomplete="organization"></label>'
        "<fieldset><legend>Request type <abbr title=\"required\">*</abbr></legend>"
        '<label class="listing-choice"><input type="radio" name="type" value="update" required> <span>Update</span></label>'
        '<label class="listing-choice"><input type="radio" name="type" value="edit"> <span>Edit</span></label>'
        '<label class="listing-choice"><input type="radio" name="type" value="deletion"> <span>Deletion</span></label>'
        '<label class="listing-choice"><input type="radio" name="type" value="new"> <span>New listing</span></label>'
        '<label class="listing-choice"><input type="radio" name="type" value="other"> <span>Other</span></label>'
        "</fieldset>"
        "<label><span>Details <abbr title=\"required\">*</abbr></span>"
        '<textarea name="details" required maxlength="4000" rows="6"></textarea></label>'
        '<button type="submit">Submit</button>'
        '<p class="listing-status" role="status" aria-live="polite"></p>'
        "</form></div>"
    )
    write(
        ROOT / "contact" / "index.html",
        layout(
            "Contact Eating on 30A about a listing",
            "Request an update, edit, deletion, or new restaurant listing on the Eating on 30A guide for Scenic Highway 30A in Walton County, Florida.",
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
            extra_scripts='<script src="/listing.js"></script>\n',
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


def build_sitemap(restaurants: list[dict], areas: list[dict], guides: list[dict]) -> None:
    stamp = newest(restaurant["updated"] for restaurant in restaurants)
    urls = [
        ("/", stamp),
        ("/restaurants/", stamp),
        ("/map/", stamp),
        ("/areas/", stamp),
        ("/guides/", stamp),
    ]
    for guide in guides:
        urls.append((guide["path"], newest(restaurant["updated"] for restaurant in guide["restaurants"])))
    urls.extend(
        [
            ("/about/", ""),
            ("/contact/", ""),
        ]
    )
    for area in areas:
        group_dates = (restaurant["updated"] for restaurant in restaurants if restaurant["areaSlug"] == area["slug"])
        urls.append((f"/areas/{area['slug']}/", newest(group_dates)))
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
        "# Public site: https://www.eatingon30a.com/ (apex eatingon30a.com redirects here).",
        f"# {ORIGIN}/llms.txt",
        f"# {ORIGIN}/llms-full.txt",
        "",
    ]
    blocks.extend(f"User-agent: {agent}\nAllow: /\n" for agent in agents)
    text = "\n".join(blocks) + f"\nSitemap: {ORIGIN}/sitemap.xml\n"
    write(ROOT / "robots.txt", text)


def build_llms(restaurants: list[dict], areas: list[dict], guides: list[dict]) -> None:
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
        f"- [Guides]({ORIGIN}/guides/): Breakfast, seafood, coffee, towns, and favorites along Scenic Highway 30A.",
        f"- [About]({ORIGIN}/about/): A restaurant guide for Scenic Highway 30A.",
        f"- [Contact]({ORIGIN}/contact/): Send a correction, edit, deletion, or new listing.",
        "",
        "## Guides",
        "",
    ]
    for guide in guides:
        lines.append(f"- [{guide['h1']}]({ORIGIN}{guide['path']}): {guide['llms']}")
    lines.extend(
        [
            "",
            "## Towns",
            "",
        ]
    )
    for area in areas:
        lines.append(
            f"- [{area['fullName']}]({ORIGIN}/areas/{area['slug']}/): {area['description']} Restaurants in {area['fullName']} on Scenic Highway 30A."
        )
    lines.extend(
        [
            "",
            "## Restaurants",
            "",
        ]
    )
    for restaurant in restaurants:
        cuisine = cuisine_phrase(restaurant["cuisines"]) or restaurant["category"] or "Restaurant"
        lines.append(
            f"- [{restaurant['name']}]({ORIGIN}/restaurants/{restaurant['slug']}/): {cuisine} in {restaurant['area']} on Scenic Highway 30A."
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
        f"- [Guides]({ORIGIN}/guides/)",
        f"- [About]({ORIGIN}/about/)",
        f"- [Contact]({ORIGIN}/contact/)",
        f"- [Short index]({ORIGIN}/llms.txt)",
        f"- [Sitemap]({ORIGIN}/sitemap.xml)",
        "",
        "## Guides",
        "",
    ]
    for guide in guides:
        full.append(f"- [{guide['h1']}]({ORIGIN}{guide['path']}): {guide['llms']}")
    full.extend(
        [
            "",
            "## Restaurants",
            "",
        ]
    )
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
    shutil.rmtree(ROOT / "guides", ignore_errors=True)
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
    guides = build_guides(restaurants, areas)
    build_about()
    build_contact()
    build_404()
    build_sitemap(restaurants, areas, guides)
    build_robots()
    build_llms(restaurants, areas, guides)
    photos = sum(1 for restaurant in restaurants if restaurant["cardImage"])
    print(f"Built {len(restaurants)} restaurants, {len(areas)} towns, {photos} photos, {len(guides)} guides")


if __name__ == "__main__":
    main()
