# Eating on 30A: architecture

Last checked against the code and Cloudflare on Oct 8, 2026.

## What it does

A static restaurant guide for Scenic Highway 30A (Walton County, FL). The Worker serves the generated pages and handles coupon signup, listing requests, the list your restaurant form, shared accounts (sign in, My places), and the listing admin. This repo also holds the code for the separate `eating-accounts` Worker (see below).

## Domains and Worker

- Worker: `eatingon30a`
- Custom domains (attached in the Cloudflare dashboard, not in `wrangler.jsonc`): `eatingon30a.com`, `www.eatingon30a.com`. Canonical is https://www.eatingon30a.com (apex redirects to www).
- workers.dev host: https://eatingon30a.352marc.workers.dev (marked noindex)

## Data and images

- Directory data: `data/restaurants.csv` and `data/locations.csv` in this repo are the source of truth. `scripts/build.py` generates the HTML, `data/catalog.json`, and the sitemap. Raw CSVs are not uploaded (`.assetsignore`).
- Photos: `images/restaurants/<slug>/` in this repo, served as static assets.
- Admin listing edits and admin uploaded photos: stored by `eating-accounts` (D1 `eating-accounts`, R2 `eating-listings`). They override the `data/catalog.json` baseline per guide.
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
- Exception: `eating-accounts` (shared accounts, admin API, magic links for both food sites). Its code is in `accounts/` here (`worker.js`, `listings.js`, `schema.js`, `migrations/`, `wrangler.jsonc`), and it imports `../listing-model.js` from the repo root. It has no Workers Builds trigger, so merging changes to `accounts/` does NOT deploy it. It has been deployed by hand.

TODO: write down the exact hand deploy steps for `eating-accounts` (dashboard upload or wrangler from a local copy).

## Known gotchas

- Do not add a custom domain or route to `wrangler.jsonc`. The domains are attached in the dashboard.
- `run_worker_first` is `true` on purpose, so the apex to www redirect runs before static HTML. An `/api/*` only route list breaks form POSTs from apex pages (CORS preflight).
- Shared accounts: `eatingon30a`, `eatingindestin`, and `eating-accounts` must all hold the same `ACCOUNTS_SHARED_SECRET`. Change it on all three together.
- Cookies: `ea_central` lives on the accounts host and `ea_session` on each guide host. Never set a `Domain` attribute; the two guides share no parent domain.
- `accounts/wrangler.jsonc` in this repo still has a placeholder `database_id`. The live D1 id is `f3ae29af-a929-4185-b5bd-b349cc015a3f`.
- `eating-accounts` D1 migrations (`accounts/migrations/`) are applied by hand. The Worker also adds the `saves.note` column itself if it is missing.
- `SUBSCRIBE_FROM` must be a sender on a domain verified in Resend, or mail is not delivered.
- Missing mail, Sheets, or Zoho secrets fail soft (the request still succeeds). Check the `delivered` and `recorded` flags. `recorded` is true only when the webhook returns JSON with `ok: true`.
- Sheets token names are mirrored across the two guides: here `GOOGLE_SHEETS_WEBHOOK_TOKEN` is the 30A tab and `GOOGLE_SHEETS_WEBHOOK_TOKEN_DESTIN` is the Destin tab.
- Commit the regenerated HTML, JSON, and sitemap together with CSV edits.

TODO: decide whether `accounts/wrangler.jsonc` should carry the live D1 id instead of the placeholder.
TODO: record which Resend verified domain `SUBSCRIBE_FROM` uses (the value is a secret and cannot be read back).

## Standing rule

Any PR that changes architecture (new secret, cron, storage, binding, or deploy change) must update this file in the same PR.
