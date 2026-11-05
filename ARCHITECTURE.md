# Eating on 30A: architecture

Last checked against the code on Nov 5, 2026.

## What it does

A static restaurant guide for Scenic Highway 30A (Walton County, FL). The Worker serves the generated pages and handles coupon signup, listing requests, the list your restaurant form, shared accounts (sign in, My places), and the listing admin. This repo also holds the code for the separate `eating-accounts` Worker (see below).

## Domains and Worker

- Worker: `eatingon30a`
- Custom domains (attached in the Cloudflare dashboard, not in `wrangler.jsonc`): `eatingon30a.com`, `www.eatingon30a.com`. Canonical is https://www.eatingon30a.com (apex redirects to www).
- workers.dev host: https://eatingon30a.352marc.workers.dev (marked noindex)

## Data and images

- Directory data: `data/restaurants.csv` and `data/locations.csv` in this repo are the source of truth. `scripts/build.py` generates the HTML, `data/catalog.json`, and the sitemap. Raw CSVs are not uploaded (`.assetsignore`).
- Photos: `images/restaurants/<slug>/` in this repo, served as static assets.
- Admin listing edits and admin uploaded photos: stored by `eating-accounts` (D1 `eating-accounts`, R2 `eating-listings`). They override the `data/catalog.json` baseline per guide. Listing fields live in the JSON `listings.payload` column. There is no separate column for amenities, so new booleans do not need a D1 migration.
- Cross-guide admin: the browser stays on one origin and still sends that origin's admin session. The Worker uses its bundled `data/catalog.json` for its own guide (`ACCOUNT_SITE`). For the other guide it fetches that guide's public `/data/catalog.json` from the Worker, not from the browser, then merges the shared D1 rows. An empty override payload does not crash the list. A failed sister fetch returns JSON, not an HTML error page. Checkbox choices are loaded per guide from that guide's catalog. A value already stored on the listing stays in the form even when the other guide's list does not include it, and inactive status stays inactive. A failed sister catalog does not wipe the local guide's choices. Eating in Destin runs its own copy of `catalog-store.js`, `catalog.js`, `admin-api.js`, and `admin.js`. Both copies have to be deployed before switching works from both admins. No CORS header is added.
- `waterfront` and `bar` are booleans on every listing (display labels Waterfront and Bar Scene). They default to false. The baseline values are `Waterfront` and `Bar Scene` columns on `data/restaurants.csv` (`["Yes"]` / `["No"]`), written through `scripts/build.py` into `data/catalog.json` and `data/restaurants.json`. Approved tags: 13 waterfront and 27 bar. Every other published listing is false.
- Directory and map filters read `area`, `meal`, `cuisine`, `q`, `outdoor`, `kids`, `music`, `reservations`, `groups`, `happyfood`, `happydrinks`, `laurensFavorite`, plus `price` (`$`, `$$`, `$$$`, `$$$$`), `waterfront=yes`, `bar=yes`, and `happyhour=yes` (happy hour food or happy hour drinks). The homepage hero and the restaurants directory use the same chip controls (`hero-chip` buttons, a More filters panel, and Clear all) and the same chip binding in `site.js`. On the directory, town, meal, cuisine, and price are single-select chip groups. The nearby town chip is labeled Santa Rosa Beach and still uses `area=nearby`, so older links keep working. Amenity chips can combine. Happy hour drinks and Lauren's Favorites are directory chips the homepage does not show. The map keeps the select and checkbox form. Restaurant cards stay in the directory HTML. Waterfront and Bar Scene controls stay hidden while no live listing has that tag.
- An admin override whose payload omits `waterfront` or `bar` keeps the baseline value for that flag. An explicit true or false in the payload replaces it. Red's Pub (`redds-pub`) and The Red Bar (`the-red-bar-grayton-beach`) already have override rows, so their tags show from the baseline without a D1 write.
- `createListing`, `updateListing`, and `setListingActive` share one payload write. A request that omits `waterfront` or `bar` keeps the boolean already stored on that row. An explicit `true` sets the flag and an explicit `false` clears it. If there is no stored row, or the stored payload has no boolean for that key, the missing key stays out of the payload so each guide's catalog merge still uses the CSV baseline. The same rules apply to `30a` and `destin`. Listing validation is unchanged: accepted yes/no values are stored as booleans, and unknown keys are dropped. Photo and delete writes keep the payload they already loaded. These rules take effect when `eating-accounts` is hand-deployed. Until that deploy, the worker still running writes a missing key as false.
- Listing visibility (live, draft, inactive): stored in D1 `listings.status` on `eating-accounts`. The built CSV and HTML stay in the repo; inactive rows hide a listing on the public site and send its restaurant URL to the matching town page with a 301. Reactivating clears the inactive status without deleting data. Toggle this at https://www.eatingon30a.com/admin/ (Deactivate / Reactivate buttons). No redeploy is required per change once the guides and accounts Workers are live.
- Accounts, sessions, saves, and save notes: D1 `eating-accounts` (id `f3ae29af-a929-4185-b5bd-b349cc015a3f`), owned by `eating-accounts`.
- External services: Resend (email), a Google Sheets Apps Script webhook (coupon rows), Zoho Campaigns (list subscribe).

Bindings on `eatingon30a`: `ASSETS` (static assets, directory `.`), vars `ACCOUNT_SITE` (`30a`) and `ACCOUNTS_ORIGIN` (`https://eating-accounts.352marc.workers.dev`). No D1, R2, or KV is bound to this Worker. The code also accepts an optional `ACCOUNTS` service binding, but none is set, so it calls `ACCOUNTS_ORIGIN` over HTTPS.

Bindings on `eating-accounts`: `DB` (D1 `eating-accounts`), `PHOTOS` (R2 `eating-listings`).

## Secrets and env vars (names only)

`eatingon30a` secrets: `ACCOUNTS_SHARED_SECRET`, `CONTACT_EMAIL`, `RESEND_API_KEY`, `SUBSCRIBE_FROM`, `GOOGLE_SHEETS_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_TOKEN`, `GOOGLE_SHEETS_WEBHOOK_TOKEN_DESTIN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_LIST_KEY_30A`, `ZOHO_LIST_KEY_DESTIN`.

`eating-accounts` secrets: `ACCOUNTS_SHARED_SECRET`, `RESEND_API_KEY`, `SUBSCRIBE_FROM`.

Optional, read by the code but not set today: `ADMIN_EMAILS` (comma list; when unset, admins fall back to `DEFAULT_ADMINS` in `listing-model.js`, which is marc@whpinc.com), `ACCOUNTS_PUBLIC_ORIGIN` (eating-accounts), `MAGIC_LINK_PREVIEW` (local testing only, never set it in production).

## Cron and scheduled jobs

None. There is no scheduled handler in the code, and neither `eatingon30a` nor `eating-accounts` has a cron trigger.

## How it deploys

- `eatingon30a` uses Cloudflare Workers Builds, auto deploy on merge to `main`. Repo `marcongit850/eatingon30A`, trigger `8350b4fd-1e82-4b49-8400-3815e6c16911`, build command `npm run build` (runs `python3 scripts/build.py`), deploy command `npx wrangler deploy`, root `/`.
- If a merge does not deploy: `POST /accounts/f1c59948520f1ec39473238b621c7e24/builds/triggers/8350b4fd-1e82-4b49-8400-3815e6c16911/builds` with body `{"branch": "main", "commit_hash": "<full 40 character sha>"}`. Check builds with `GET /accounts/f1c59948520f1ec39473238b621c7e24/builds/workers/ef11517d823d44458978e8a3f605f528/builds?per_page=2` and match `commit_hash`.
- Exception: `eating-accounts` (shared accounts, admin API, magic links for both food sites). Its code is in `accounts/` here (`worker.js`, `listings.js`, `schema.js`, `migrations/`, `wrangler.jsonc`), and it imports `../listing-model.js` from the repo root. It has no Workers Builds trigger, so merging changes to `accounts/` does NOT deploy it.
- Hand deploy from `accounts/` with `npx wrangler deploy`. That file's `database_id` is the live D1 database `eating-accounts` (`f3ae29af-a929-4185-b5bd-b349cc015a3f`). Do not create another database and do not change secrets as part of a code deploy.
- After any accounts change, hard reload the admin page (https://www.eatingon30a.com/admin/) before saving. A cached admin page can submit a listing without the fields the new Worker expects.

## SEO

- Public pages share one layout in `scripts/build.py`. It writes the robots meta (`index,follow` with large image preview, except pages marked noindex), Open Graph, Twitter card, theme color, favicon, and apple touch icon. Listing pages use `og:type` `restaurant.restaurant`. Every public JSON-LD graph includes the site `WebSite` (with the `/restaurants/?q=` search action) and `Organization`. There is no brand social profile in the repo, so `Organization` has no `sameAs`.
- Restaurant schema adds `openingHoursSpecification` only when the hours already on the page parse to clock times, including a line like "from 6pm, close 10pm". "Check website", temporary closures, and open-ended "to close" lines stay in the visible hours and are left out of the schema. A listing with a logo and no photograph uses that logo as `image`. The schema does not include a menu URL, `hasMenu`, or ratings. `scripts/check-jsonld.py` parses every page's JSON-LD. Hiding a listing removes its `ListItem` without leaving a trailing comma.
- `assets.html_handling` stays `auto-trailing-slash` so `/restaurants/` serves `restaurants/index.html`. That mode's own redirect is a 307 and the status cannot be set to 301. `trailingSlashRedirect` in `worker.js` answers a directory URL with a 301 before assets run. Do not switch `html_handling` to `none`. The catalog overlay also returns a 3xx from assets unchanged, so a redirect keeps its `Location` header. Flat HTML under `/includes/` (`header.html`, `footer.html`) is not a directory. `auto-trailing-slash` serves those at `/includes/header` and `/includes/footer` and 307s both the `.html` URL and a trailing slash back to that path. `directorySlashPath` leaves `/includes/` alone so the 301 does not loop with that 307. `header.js` and `footer.js` still fetch the `.html` URLs. The browser follows the 307 and receives the fragment.
- HTML responses from the Worker use `Content-Type: text/html; charset=utf-8`. Static asset HTML that arrives without a charset gets one in `withHtmlCharset`.
- Old restaurant slugs 301 in `worker.js` (`legacyAmpersandRedirect`). The same function folds curly apostrophes, accents, and `&` / `%26`, then uses a small explicit map. Seagrove Village Market Café stays deactivated. Its old slug 301s to `/areas/seagrove-beach/` and is not turned back on. `/explore30a` 301s to the homepage. `/terms-and-conditions` 301s to `/about/` because the site has no terms page. Blue Mabel Smokehouse has no current listing and stays a real 404.
- The restaurant directory at `/restaurants/` prints every name and link in the server HTML. Filters still hide cards in the browser.
- Listing titles and descriptions use the town from the address. The US 98 group is not called Nearby in a title, H1, or description.
- Preview hosts (`*.workers.dev`) keep `noindex` in the response header and in the HTML robots meta.

## Known gotchas

- Do not add a custom domain or route to `wrangler.jsonc`. The domains are attached in the dashboard.
- `run_worker_first` is `true` on purpose, so the apex to www redirect and the trailing-slash 301 run before static HTML. An `/api/*` only route list breaks form POSTs from apex pages (CORS preflight).
- Shared accounts: `eatingon30a`, `eatingindestin`, and `eating-accounts` must all hold the same `ACCOUNTS_SHARED_SECRET`. Change it on all three together.
- Cookies: `ea_central` lives on the accounts host and `ea_session` on each guide host. Never set a `Domain` attribute; the two guides share no parent domain.
- `accounts/wrangler.jsonc` binds D1 `eating-accounts` (`f3ae29af-a929-4185-b5bd-b349cc015a3f`). Deploy from `accounts/` so Wrangler reads that file. A placeholder `database_id` makes `wrangler deploy` fail.
- `eating-accounts` D1 migrations (`accounts/migrations/`) are applied by hand. The Worker also adds the `saves.note` column itself if it is missing. After deploying the accounts Worker with inactive support, run `accounts/migrations/0004_inactive_market_cafes.sql` on D1 to deactivate both Seagrove Village Market Café locations on 30A.
- `SUBSCRIBE_FROM` must be a sender on a domain verified in Resend, or mail is not delivered.
- Missing mail, Sheets, or Zoho secrets fail soft (the request still succeeds). Check the `delivered` and `recorded` flags. `recorded` is true only when the webhook returns JSON with `ok: true`.
- Sheets token names are mirrored across the two guides: here `GOOGLE_SHEETS_WEBHOOK_TOKEN` is the 30A tab and `GOOGLE_SHEETS_WEBHOOK_TOKEN_DESTIN` is the Destin tab.
- Commit the regenerated HTML, JSON, and sitemap together with CSV edits.

TODO: record which Resend verified domain `SUBSCRIBE_FROM` uses (the value is a secret and cannot be read back).

## Standing rule

Any PR that changes architecture (new secret, cron, storage, binding, or deploy change) must update this file in the same PR.
