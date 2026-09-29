# Eating on 30A

A static restaurant guide for Scenic Highway 30A in Walton County, Florida. It replaces the Wix site with pages generated from two CSV files. The directory, town shortcuts, and map all use those files. There is no Airtable base and no Google Places or Google Maps API.

The Cloudflare Worker name is `eatingon30a`. Do not attach `eatingon30a.com` or any other custom domain to this Worker. Vanity DNS stays where it is until someone moves it on purpose.

Preview (workers.dev only):

https://eatingon30a.mud-cormorant.workers.dev

That hostname is the preview from `npx wrangler deploy --temporary`. The first visit can show a short Cloudflare “verify you are human” check. `site.config.json` sets `origin` to this same URL for canonical links and the sitemap. Do not point the sitemap at the Wix domain.

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

## Edit the directory

`data/restaurants.csv` and `data/locations.csv` are the source of truth. Edit those files, then regenerate:

```bash
python3 scripts/build.py
```

Commit the CSV and the generated HTML, JSON, sitemap, and robots file together. The build does not call a network API.

Columns that show up on the site:

- `Restaurant Name`, `slug` (leave the slug blank and the build makes one from the old path plus the town if needed)
- `map_area`, `map_area_slug`, `location_label`, `subarea`
- `address` (JSON with `formatted` and `location.latitude` / `location.longitude`)
- `phone`, `website`, `price`, `notes`, `hours`
- `List Image`, `Detail Image`, `Logo` (`https://` URLs, or `wix:image://` URLs, which the build turns into `static.wixstatic.com` links)
- `Cuisine Type`, `Meal Type`, `Food Type`, `Vibe`, `Category` (JSON arrays)
- `Outdoor Dining`, `Kid Friendly`, `Live Music`, `Happy Hour (drinks)`, `Happy Hour (food)`, `Reservations`
- `Facebook URL`, `Instagram`
- `Status` must be `PUBLISHED`

`data/locations.csv` supplies town names, short descriptions, and town photos. Towns that exist only on restaurants (Watersound and Watersound Origins) still appear.

Only a couple of restaurants in the export have images. One list image is a black heart shape, so the build skips that file and uses the detail photo instead. That detail file is a very large PNG on Wix, so the page uses the compressed copy at `images/restaurants/stinkys-fish-camp.jpg`. Every other card without a working image URL gets a color block.

The raw CSV is not uploaded with the site (see `.assetsignore`). It includes export columns such as owner ids and `googlePlaceId`. Those columns are not read into the public JSON and are not sent to Google.

## Deploy

Cloudflare Workers static assets, same shape as the other 30A sites. `wrangler.jsonc` sets `"name"` to `eatingon30a` and `"assets.directory"` to `.`. There is no Worker script and no custom domain route.

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
