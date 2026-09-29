# Eating on 30A

A static restaurant guide for Scenic Highway 30A in Walton County, Florida. Every `PUBLISHED` row in `data/restaurants.csv` is on the site: one profile page each, plus the directory and the map.

The visual direction is an editorial coastal guide: full-bleed hero, serif display type, and monogram frames where a listing has no photograph. Meal, town, cuisine, and search filters work across the full directory. The map uses the same listings.

There is no Airtable base and no Google Places or Google Maps API.

The Cloudflare Worker name is `eatingon30a`. Do not attach `eatingon30a.com` or any other custom domain to this Worker. Vanity DNS stays where it is until someone moves it on purpose.

Preview (workers.dev only):

https://eatingon30a.352marc.workers.dev

That hostname is the workers.dev preview. Do not attach a custom domain. The first visit can show a short Cloudflare “verify you are human” check. `site.config.json` sets `origin` to this same URL for canonical links, Open Graph URLs, the sitemap, and `llms.txt`. Override it for one build with `SITE_ORIGIN` if the preview host changes. Do not point the sitemap at the Wix domain.

## Preview locally

From the repository root:

```bash
python3 scripts/build.py
python3 -m http.server 8080
```

Open `http://localhost:8080/`.

```bash
npm test
```

That rebuilds the site, checks the generated pages, and checks the filter rules.

## One profile template

`build_detail()` in `scripts/build.py` is the only restaurant profile template. `card()` is the only directory card. `includes/header.html` and `includes/footer.html` are the shared navigation, loaded by every page through `header.js` and `footer.js`. Change a link in those two files and it shows on every page. The build does not copy the nav into each HTML file.

`SAMPLE_SLUGS` in `scripts/build.py` is `None`, so the build publishes every `PUBLISHED` row.

## Edit the directory

`data/restaurants.csv` and `data/locations.csv` are the source of truth. Edit the CSVs, then regenerate:

```bash
python3 scripts/build.py
```

Commit the CSV and the generated HTML, JSON, sitemap, and robots file together. The build does not call a network API.

## Featured cover

The homepage “From the guide” slot rotates through the `featured` list in `site.config.json`. One listing shows for each UTC day, in list order, then the rotation starts over. Previous and Next on that cover step through the same list, wrapping at either end, and the day still picks the first slide. Without JavaScript, the first slug stays on screen and the arrows stay hidden. The cover itself does not change: photo or monogram, name, lede, town and price line, and a profile link.

To add or remove a spot, edit that list and rebuild:

```bash
python3 scripts/build.py
```

Each value must be the slug of a `PUBLISHED` restaurant. Order is the rotation order. A paid placement is the same edit: put its slug in `featured`, rebuild, and commit `site.config.json` with the new homepage.

Columns that show up on the site:

- `Restaurant Name`, `slug` (leave the slug blank and the build makes one from the old path plus the town if needed)
- `map_area`, `map_area_slug`, `location_label`, `subarea`
- `address` (JSON with `formatted` and `location.latitude` / `location.longitude`). Every published row already has both, so the map does not geocode and does not invent coordinates. Pins that share one storefront are nudged apart on screen only.
- `phone`, `website`, `price`, `notes`, `hours`
- `List Image`, `Detail Image`, `Logo` (`https://` URLs, or `wix:image://` URLs, which the build turns into local files or `static.wixstatic.com` links)
- `Cuisine Type`, `Meal Type`, `Food Type`, `Vibe`, `Category` (JSON arrays)
- `Outdoor Dining`, `Kid Friendly`, `Live Music`, `Happy Hour (drinks)`, `Happy Hour (food)`, `Reservations`
- `Facebook URL`, `Instagram`
- `Status` must be `PUBLISHED`

`data/locations.csv` supplies town names, short descriptions, and town photos. Towns that exist only on restaurants (Watersound and Watersound Origins) still appear.

Image columns are `List Image`, `Detail Image`, and `Logo`. In this export, and on the live Wix site checked 29 Sep 2026, only Stinky’s Fish Camp has them filled. The list image is a black heart, so the build skips it. Stinky’s logo is still the local file from that export. Town photos still come from `locations.csv`.

Restaurant photos live in `images/restaurants/<slug>/`. `01` is the cover on the card, the profile hero, the map popup, and the Open Graph image. `02` and `03` show in a strip under the hero when they exist. A single file named with the site slug (`images/restaurants/o-ku-alys-beach.jpg`, `.jpeg`, `.webp`, or `.png`) still works as a cover when that folder is absent. A listing with neither keeps the monogram. The build does not call Google Places.

The raw CSV is not uploaded with the site (see `.assetsignore`). It includes export columns such as owner ids and `googlePlaceId`. Those columns are not read into the public JSON and are not sent to Google.

## Deploy

Cloudflare Worker `eatingon30a` serves the static site and `POST /api/subscribe`. `wrangler.jsonc` sets `"name"` to `eatingon30a`, `"main"` to `worker.js`, and `"assets.directory"` to `.`. There is no custom domain route.

Signup notes go out through the Resend HTTP API (`https://api.resend.com/emails`) only when all three secrets are set on the Worker:

- `RESEND_API_KEY`
- `SUBSCRIBE_FROM` — a verified Resend sender
- `CONTACT_EMAIL` — inbox that receives the signup

If any secret is missing, the worker still accepts the signup and returns `delivered: false`. It does not call another newsletter product.

```bash
npx wrangler deploy
```

Leave the custom domain empty. `eatingon30a.com` is not configured in this repo. A temporary deploy without a Cloudflare login is:

```bash
npx wrangler deploy --temporary
```

That publishes the workers.dev preview and does not attach a vanity domain. To keep using an existing Workers Builds project named `eatingon30a`, connect this repository there and leave the custom domain off.

Homepage meal and town links go to `/restaurants/?meal=Dinner` and `/restaurants/?area=seaside`. The directory reads those query parameters and hides the other cards. The map page honors the same parameters.

## Pages

- `/` meal and town entry points that filter the directory
- `/restaurants/` filterable directory
- `/restaurants/<slug>/` one restaurant
- `/map/` Leaflet on OpenStreetMap
- `/areas/` and `/areas/<slug>/` town notes
- `/about/` and `/contact/`
- `sitemap.xml`, `robots.txt`, `llms.txt`
