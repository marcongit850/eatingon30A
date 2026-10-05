# Eating on 30A

A static restaurant guide for Scenic Highway 30A in Walton County, Florida. Every `PUBLISHED` row in `data/restaurants.csv` is on the site: one profile page each, plus the directory and the map.

The visual direction is an editorial coastal guide: full-bleed hero, serif display type, and monogram frames where a listing has no photograph. Meal, town, cuisine, search, and Lauren’s Favorites filters work across the full directory. The map uses the same listings.

There is no Airtable base and no Google Places or Google Maps API.

The Cloudflare Worker name is `eatingon30a`. Do not attach `eatingon30a.com` or any other custom domain in `wrangler.jsonc`. Vanity DNS stays where it is until someone moves it on purpose.

Live site: https://www.eatingon30a.com/ (the apex host redirects to www). `site.config.json` sets `origin` to that URL for canonical links, Open Graph URLs, structured data, the sitemap, and `llms.txt`. Do not point the sitemap at a former Wix host or at the workers.dev preview.

Preview (workers.dev only):

https://eatingon30a.352marc.workers.dev

That hostname is the workers.dev preview. Do not attach a custom domain in this repo. The first visit can show a short Cloudflare “verify you are human” check. The worker marks the preview `noindex` so it does not compete with the live domain. Override `origin` for one build with `SITE_ORIGIN` if a one-off host is needed.

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

The homepage “Featured” slot rotates through the `featured` list in `site.config.json`. The UTC day picks the starting listing, in list order, then the rotation starts over. While the page is open the cover advances every 8 seconds. It pauses while the pointer or keyboard focus is inside the section, and while the tab is hidden. Visitors who prefer reduced motion keep the arrows only. Previous and Next step through the same list, wrapping at either end, announce the new listing, and restart that timer. Automatic advances stay quiet. Without JavaScript, the first slug stays on screen and the arrows stay hidden. The cover itself does not change: photo or monogram, name, lede, town and price line, and a profile link.

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
- `List Image`, `Detail Image`, `Logo` (`/images/` paths for a file in the repo, `https://` URLs, or `wix:image://` URLs, which the build turns into local files or `static.wixstatic.com` links)
- `Cuisine Type`, `Meal Type`, `Food Type`, `Vibe`, `Category` (JSON arrays)
- `Outdoor Dining`, `Kid Friendly`, `Live Music`, `Happy Hour (drinks)`, `Happy Hour (food)`, `Reservations`, `Groups of 12` (JSON `Yes`, `No`, or `In Review`). Only `Yes` is shown on the listing and matched by the directory and map checkboxes. `In Review` stays unknown.
- `Facebook URL`, `Instagram`
- `Status` must be `PUBLISHED`

`data/locations.csv` supplies town names, short descriptions, and town photos. Towns that exist only on restaurants (Watersound and Watersound Origins) still appear. A `Location Image` that starts with `/images/` is a file in the repo. When that cell is empty, the build uses `images/areas/<slug>.jpg` if the file is there. Watersound is the boardwalk photo and Watersound Origins is the entrance sign.

Image columns are `List Image`, `Detail Image`, and `Logo`. In this export, and on the live Wix site checked 29 Sep 2026, only Stinky’s Fish Camp has them filled. The list image is a black heart, so the build skips it. Stinky’s logo is still the local file from that export. Town photos still come from `locations.csv`.

Restaurant photos live in `images/restaurants/<slug>/`. `01` is the cover on the card, the profile hero, the map popup, and the Open Graph image. `02` through `07` show in a strip under the hero when they exist. A single file named with the site slug (`images/restaurants/o-ku-alys-beach.jpg`, `.jpeg`, `.webp`, or `.png`) still works as a cover when that folder is absent. A listing with neither keeps the monogram. The build does not call Google Places.

The raw CSV is not uploaded with the site (see `.assetsignore`). It includes export columns such as owner ids and `googlePlaceId`. Those columns are not read into the public JSON and are not sent to Google.

## Deploy

Cloudflare Worker `eatingon30a` serves the static site, `POST /api/subscribe`, and `POST /api/listing`. `wrangler.jsonc` sets `"name"` to `eatingon30a`, `"main"` to `worker.js`, and `"assets.directory"` to `.`. There is no custom domain route.

Signup notes and listing requests from `/contact/` go out through the Resend HTTP API (`https://api.resend.com/emails`) only when all three secrets are set on the Worker:

- `RESEND_API_KEY`
- `SUBSCRIBE_FROM` — a verified Resend sender, also used as the From address for listing mail
- `CONTACT_EMAIL` — inbox that receives the signup and listing requests

If any of those secrets is missing, the worker still accepts the signup or listing note and returns `delivered: false`. It does not call another newsletter product. A listing email sets `reply_to` to the address on the form so a reply goes back to that person.

Coupon signups (`POST /api/subscribe`) are also posted to a Google Sheets Apps Script webhook when both of these secrets are set:

- `GOOGLE_SHEETS_WEBHOOK_URL`
- `GOOGLE_SHEETS_WEBHOOK_TOKEN`

The webhook body includes `site` (`30A`), the email, coupons, an optional `audience` of `local` or `visitor`, and `sourcePage` set to the live homepage `https://www.eatingon30a.com/`. Preview canonical links stay on the workers.dev origin in `site.config.json`. The JSON response reports `recorded` separately from `delivered`. `recorded` is `true` only when the webhook body is JSON and `ok` is `true`. An HTTP 200 HTML page such as “Script function not found: doPost”, any other non-JSON body, or `{ok:false}` leaves `recorded` as `false`. If either Sheets secret is missing, the webhook is skipped and `recorded` is `false`. A Sheets error still returns success when Resend accepted the signup, so the browser does not retry and send a second email. Listing mail does not call the webhook.

```bash
npx wrangler deploy
```

Leave the custom domain empty. `eatingon30a.com` is not configured in this repo. A temporary deploy without a Cloudflare login is:

```bash
npx wrangler deploy --temporary
```

That publishes the workers.dev preview and does not attach a vanity domain. To keep using an existing Workers Builds project named `eatingon30a`, connect this repository there and leave the custom domain off.

Homepage meal and town links go to `/restaurants/?meal=Dinner` and `/restaurants/?area=seaside`. The directory reads those query parameters and hides the other cards. The map page honors the same parameters.

## Shared accounts

Eating on 30A and Eating in Destin share one account. The store is a separate Worker, `eating-accounts`, with one D1 database. Favorites and Want to try rows record which guide they came from (`30a` or `destin`). Sign-in is an email magic link. Google sign-in is not in this phase. It needs a Google OAuth client, and the magic link is the required path.

`eatingon30a.com` and `eatingindestin.com` do not share a parent domain. A browser will not send one cookie to both hosts, and a `Domain` attribute cannot bridge them. Do not set `Domain` on these cookies.

The accounts Worker sets `ea_central` on its own host only (HttpOnly, SameSite=Lax, Secure on https, no Domain). That cookie is what makes one sign-in work on both guides. The magic link opens the accounts host, which sets `ea_central`, then redirects back to the guide with a one-time code. The guide's Worker exchanges that code and sets its own `ea_session` cookie on that guide's host only. Opening Sign in or My places on the other guide sends the browser to the accounts host again. If `ea_central` is still valid, the visitor comes back signed in without a second email. Signing out deletes every session for that account, including `ea_central`, so the other guide is signed out on its next request.

`wrangler.jsonc` sets `ACCOUNT_SITE` to `30a` and `ACCOUNTS_ORIGIN` to `https://eating-accounts.352marc.workers.dev`. Change the origin if Cloudflare assigns a different workers.dev host. Do not add a custom domain binding in this repo.

Deploy the accounts Worker before sign-in will work. From `accounts/`:

```bash
npx wrangler d1 create eating-accounts
```

Put the returned `database_id` in `accounts/wrangler.jsonc` in place of the placeholder. Then:

```bash
npx wrangler deploy -c accounts/wrangler.jsonc
npx wrangler d1 migrations apply eating-accounts --remote
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SUBSCRIBE_FROM
npx wrangler secret put ACCOUNTS_SHARED_SECRET
```

`RESEND_API_KEY` and `SUBSCRIBE_FROM` are the same Resend key and verified sender the site already uses for signup mail. The message goes to the visitor, not to `CONTACT_EMAIL`. `ACCOUNTS_SHARED_SECRET` is a long random string (`openssl rand -hex 32`). Set that same secret on this Worker and on `eatingindestin`:

```bash
npx wrangler secret put ACCOUNTS_SHARED_SECRET
```

Do not set `MAGIC_LINK_PREVIEW` on the deployed accounts Worker. That variable is for local testing only. When it is `1`, the sign-in API includes the link in the JSON response.

The marketing checkbox on the sign-in form is off unless the visitor checks it. A new account stores that choice. A later sign-in can turn updates on, and leaving the box unchecked does not turn an existing opt-in off.

## Pages

- `/` meal and town entry points that filter the directory
- `/restaurants/` filterable directory
- `/restaurants/<slug>/` one restaurant
- `/map/` Leaflet on OpenStreetMap
- `/areas/` and `/areas/<slug>/` town notes
- `/guides/` and one page per guide, built from directory tags: seafood, breakfast, coffee and cafes, kid-friendly, dinner in Seaside, Rosemary Beach, WaterColor, walkable towns (Seaside, Alys Beach, and Rosemary Beach; there is no walkable tag), Lauren’s Favorites, and Nearby restaurants on US 98 (near 30A, not on the beach road)
- `/about/` and `/contact/`
- `/account/` email sign-in, shared with Eating in Destin
- `/my-places/` favorites and want to try, labeled 30A or Destin
- `sitemap.xml`, `robots.txt`, `llms.txt`
