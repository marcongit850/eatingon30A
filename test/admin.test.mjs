import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { describe } from "node:test";
import { handleAccount } from "../account-api.js";
import { handleAdmin } from "../admin-api.js";
import { LISTINGS_SQL, SCHEMA_SQL } from "../accounts/schema.js";
import { handleAccounts, resetLimits } from "../accounts/worker.js";
import { invalidateCatalog } from "../catalog-store.js";
import baseline from "../data/catalog.json" with { type: "json" };
import { canonicalListingSlug, mergeCatalog, publicRecords } from "../catalog.js";
import { patchHtml, patchLlms, patchSitemap } from "../public-html.js";
import worker from "../worker.js";

const ORIGIN = "http://127.0.0.1:8788";
const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xd9]);

function contentTypeFor(pathname) {
  if (pathname.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".ico")) return "image/x-icon";
  return "text/html; charset=utf-8";
}

function diskAssets() {
  return {
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/404.html") {
        return new Response("missing page", { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      let rel = pathname;
      if (rel.endsWith("/")) rel += "index.html";
      if (rel === "/") rel = "/index.html";
      const file = join(REPO_ROOT, rel);
      if (!existsSync(file)) return new Response("not found", { status: 404 });
      return new Response(readFileSync(file), { headers: { "content-type": contentTypeFor(rel) } });
    },
  };
}

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  return {
    prepare(sql) {
      const statement = (params) => ({
        async first() {
          return db.prepare(sql).get(...params) ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all(...params) };
        },
        async run() {
          const info = db.prepare(sql).run(...params);
          return { success: true, meta: { changes: info.changes } };
        },
        bind(...next) {
          return statement(next);
        },
      });
      return statement([]);
    },
  };
}

function memoryBucket() {
  const objects = new Map();
  return {
    async put(key, body) {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, bytes);
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
    async delete(key) {
      objects.delete(key);
    },
    objects,
  };
}

function accountsEnv(db, extra = {}) {
  return {
    DB: db,
    ACCOUNTS_SHARED_SECRET: "test-secret",
    ACCOUNTS_PUBLIC_ORIGIN: "http://127.0.0.1:8787",
    MAGIC_LINK_PREVIEW: "1",
    ...extra,
  };
}

function siteEnv(db, bucket, { assets = "mock" } = {}) {
  const shared = accountsEnv(db, { PHOTOS: bucket });
  const mockAssets = {
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/404.html") return new Response("missing page", { headers: { "content-type": "text/html" } });
        if (path === "/sitemap.xml") {
          return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://www.eatingon30a.com/restaurants/${baseline[0].slug}/</loc>\n  </url>\n</urlset>\n`);
        }
        if (path === "/llms.txt") {
          return new Response(`## Restaurants\n\n- [${baseline[0].name}](https://www.eatingon30a.com/restaurants/${baseline[0].slug}/): test.\n\n## Towns\n`);
        }
        if (path === "/restaurants/" || path === "/restaurants/index.html") {
          return new Response(`<div id="cards" class="card-grid"><article id="r-${baseline[0].slug}" class="card" data-area="${baseline[0].areaSlug}">${baseline[0].name}</article></div>`, {
            headers: { "content-type": "text/html" },
          });
        }
        return new Response(`<article id="r-${baseline[0].slug}" class="card">${baseline[0].name}</article>`, {
          headers: { "content-type": "text/html" },
        });
      },
  };
  return {
    ACCOUNT_SITE: "30a",
    ACCOUNTS_SHARED_SECRET: "test-secret",
    ACCOUNTS_ORIGIN: "http://127.0.0.1:8787",
    ACCOUNTS: { fetch: (request) => handleAccounts(request, shared) },
    ASSETS: assets === "disk" ? diskAssets() : mockAssets,
    CATALOG_FETCH: async () => new Response("[]", { headers: { "content-type": "application/json" } }),
  };
}

function jsonCatalog(rows, status = 200) {
  return new Response(JSON.stringify(rows), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cookieValue(header, name) {
  const pair = String(header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  assert.ok(pair, `missing ${name}`);
  return pair.slice(name.length + 1);
}

async function signIn(db, env, email) {
  resetLimits();
  const requested = await handleAccount(new Request(`${ORIGIN}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, next: "/admin/" }),
  }), env);
  const body = await requested.json();
  assert.equal(body.ok, true, body.error);
  const verified = await handleAccounts(new Request(body.previewUrl), accountsEnv(db, { PHOTOS: env.PHOTOS }));
  assert.equal(verified.status, 302);
  const finished = await handleAccount(new Request(verified.headers.get("location")), env);
  assert.equal(finished.status, 302);
  return cookieValue(finished.headers.get("set-cookie"), "ea_session");
}

function adminRequest(path, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("cookie", `ea_session=${token}`);
  return new Request(`${ORIGIN}${path}`, { ...options, headers });
}

describe("restaurant admin", { concurrency: 1 }, () => {
  test("listing migration matches the worker schema", () => {
    const file = readFileSync(new URL("../accounts/migrations/0003_listings.sql", import.meta.url), "utf8").trim();
    assert.equal(file, LISTINGS_SQL);
  });

  test("the listing editor and table link to the public page for the selected guide", () => {
    const source = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
    assert.match(source, /"30a": "https:\/\/www\.eatingon30a\.com"/);
    assert.match(source, /destin: "https:\/\/www\.eatingindestin\.com"/);
    assert.match(source, /\/restaurants\/" \+ encodeURIComponent\(slug\) \+ "\//);
    assert.match(source, /class="button secondary admin-public-link"/);
    assert.match(source, /target="_blank" rel="noopener noreferrer"/);
    assert.match(source, />Link<\/a>/);
    assert.equal(source.includes('href="/restaurants/'), false);
    assert.equal(source.includes('>View</a>'), false);
    assert.equal(source.includes('state.site === "30a"'), false);
    assert.equal(source.split("publicLink(").length - 1, 4);
  });

  test("a LaCo override saved under the old slug stays on the new listing", () => {
    const base = [{ slug: "laco-seacrest", name: "LaCo", area: "Seacrest", phone: "(850) 231-4021", hours: "Daily 11am-9pm" }];
    const merged = mergeCatalog(base, [{
      slug: "la-cocina-seacrest",
      status: "live",
      deleted: false,
      payload: { notes: "Patio seating", phone: "(850) 231-4021" },
    }]);
    assert.equal(canonicalListingSlug("la-cocina-seacrest"), "laco-seacrest");
    assert.equal(merged.length, 1);
    assert.equal(merged[0].slug, "laco-seacrest");
    assert.equal(merged[0].source, "override");
    assert.equal(merged[0].notes, "Patio seating");
    assert.equal(merged[0].phone, "(850) 231-4021");
    assert.equal(merged.some((item) => item.slug === "la-cocina-seacrest"), false);
  });

  test("an override without waterfront or bar keeps the baseline tags", () => {
    const red = baseline.find((item) => item.slug === "the-red-bar-grayton-beach");
    const redd = baseline.find((item) => item.slug === "redds-pub");
    assert.equal(red.waterfront, true);
    assert.equal(red.bar, true);
    assert.equal(redd.waterfront, false);
    assert.equal(redd.bar, true);
    const omit = (listing) => {
      const payload = { ...listing };
      delete payload.waterfront;
      delete payload.bar;
      return payload;
    };
    const merged = mergeCatalog(baseline, [
      { slug: red.slug, status: "live", deleted: false, payload: omit(red) },
      { slug: redd.slug, status: "live", deleted: false, payload: omit(redd) },
    ]);
    const redOut = merged.find((item) => item.slug === red.slug);
    const reddOut = merged.find((item) => item.slug === redd.slug);
    assert.equal(redOut.waterfront, true);
    assert.equal(redOut.bar, true);
    assert.equal(reddOut.waterfront, false);
    assert.equal(reddOut.bar, true);
    assert.equal(publicRecords(merged).find((item) => item.slug === red.slug).waterfront, true);
    assert.equal(publicRecords(merged).find((item) => item.slug === redd.slug).bar, true);
    const cleared = mergeCatalog(
      [{ slug: "pier-flag", name: "Pier Flag", area: "Seaside", waterfront: true, bar: true }],
      [{ slug: "pier-flag", status: "live", deleted: false, payload: { name: "Pier Flag", area: "Seaside", waterfront: false } }],
    );
    assert.equal(cleared[0].waterfront, false);
    assert.equal(cleared[0].bar, true);
  });

  test("the built catalog has editable fields and no SEO keys", () => {
    assert.ok(baseline.length > 100);
    const sample = baseline[0];
    assert.equal(typeof sample.slug, "string");
    assert.equal(typeof sample.area, "string");
    assert.ok(Array.isArray(sample.photos));
    for (const key of ["seo", "metaTitle", "metaDescription", "ogTitle", "canonical", "jsonLd"]) {
      assert.equal(Object.hasOwn(sample, key), false);
    }
  });

  test("a draft is hidden and a live edit keeps the new area", () => {
    const base = [{
      slug: "pier-test",
      name: "Pier Test",
      area: "Seaside",
      areaSlug: "seaside",
      photos: [{ id: null, src: "/images/restaurants/pier-test/01.jpg" }],
      meals: ["Lunch"],
      cuisines: ["Seafood"],
      foods: [],
      price: "$$",
      lat: 30.3,
      lng: -86.1,
      address: "1 Pier",
      phone: "",
      notes: "On the pier",
    }];
    const draft = mergeCatalog(base, [{
      slug: "pier-test",
      status: "draft",
      deleted: false,
      payload: { ...base[0], area: "Grayton Beach", areaSlug: "grayton-beach" },
    }]);
    assert.equal(publicRecords(draft).length, 0);
    const inactive = mergeCatalog(base, [{
      slug: "pier-test",
      status: "inactive",
      deleted: false,
      payload: { ...base[0], area: "Grayton Beach", areaSlug: "grayton-beach" },
    }]);
    assert.equal(publicRecords(inactive).length, 0);
    const live = mergeCatalog(base, [{
      slug: "pier-test",
      status: "live",
      deleted: false,
      payload: { ...base[0], area: "Grayton Beach" },
    }]);
    assert.equal(publicRecords(live)[0].area, "Grayton Beach");
    assert.equal(publicRecords(live)[0].areaSlug, "grayton-beach");
    const html = patchHtml(
      `<div id="cards" class="card-grid"><article id="r-pier-test" class="card" data-area="seaside">Pier Test</article></div>`,
      "/restaurants/",
      { hidden: draft.filter((item) => item.status === "draft"), placed: [] },
    );
    assert.equal(html.includes("pier-test"), false);
    const sitemap = patchSitemap(
      `<urlset><url><loc>https://www.eatingon30a.com/restaurants/pier-test/</loc></url></urlset>`,
      { hidden: draft, placed: [] },
    );
    assert.equal(sitemap.includes("pier-test"), false);
    const ampSitemap = patchSitemap(
      `<urlset><url><loc>https://www.eatingon30a.com/restaurants/raw-%26-juicy/</loc></url><url><loc>https://www.eatingon30a.com/restaurants/raw-and-juicy-alys-beach/</loc></url></urlset>`,
      { hidden: [], placed: [] },
    );
    assert.equal(ampSitemap.includes("%26"), false);
    assert.equal(ampSitemap.includes("raw-and-juicy-alys-beach"), true);
    const llms = patchLlms("- [Pier Test](https://www.eatingon30a.com/restaurants/pier-test/): test.\n\n## Towns\n", {
      hidden: draft,
      placed: [],
    });
    assert.equal(llms.includes("pier-test"), false);
  });

  test("marc can edit, upload, and hide a listing; a visitor cannot", async () => {
    invalidateCatalog();
    resetLimits();
    const db = memoryDb();
    const bucket = memoryBucket();
    const env = siteEnv(db, bucket);
    env.PHOTOS = bucket;
    const sample = baseline.find((item) => item.area !== "Seaside");
    const marc = await signIn(db, env, "marc@whpinc.com");
    const me = await handleAccount(adminRequest("/api/account/me", marc), env);
    const meBody = await me.json();
    assert.equal(meBody.user.email, "marc@whpinc.com");
    assert.equal(meBody.user.isAdmin, true);

    const drafted = await handleAdmin(adminRequest(`/api/admin/listings/${sample.slug}`, marc, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...sample, site: "30a", status: "draft", area: "Seaside" }),
    }), env);
    assert.equal(drafted.status, 200, JSON.stringify(await drafted.clone().json()));

    const hiddenJson = await worker.fetch(new Request("https://www.eatingon30a.com/data/restaurants.json"), env);
    const hiddenRows = await hiddenJson.json();
    assert.equal(hiddenRows.some((item) => item.slug === sample.slug), false);
    const hiddenPage = await worker.fetch(new Request(`https://www.eatingon30a.com/restaurants/${sample.slug}/`), env);
    assert.equal(hiddenPage.status, 404);
    const hiddenList = await worker.fetch(new Request("https://www.eatingon30a.com/restaurants/"), env);
    assert.equal((await hiddenList.text()).includes(`id="r-${sample.slug}"`), false);
    const hiddenMap = await worker.fetch(new Request("https://www.eatingon30a.com/sitemap.xml"), env);
    assert.equal((await hiddenMap.text()).includes(`/restaurants/${sample.slug}/`), false);

    const published = await handleAdmin(adminRequest(`/api/admin/listings/${sample.slug}`, marc, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...sample, site: "30a", status: "live", area: "Seaside" }),
    }), env);
    assert.equal(published.status, 200);
    const liveJson = await (await worker.fetch(new Request("https://www.eatingon30a.com/data/restaurants.json"), env)).json();
    const liveRow = liveJson.find((item) => item.slug === sample.slug);
    assert.equal(liveRow.area, "Seaside");
    assert.equal(liveRow.areaSlug, "seaside");
    const profile = await worker.fetch(new Request(`https://www.eatingon30a.com/restaurants/${sample.slug}/`), env);
    assert.equal(profile.status, 200);
    assert.match(await profile.text(), /Seaside/);

    const form = new FormData();
    form.set("site", "30a");
    form.set("status", "live");
    form.set("file", new File([JPEG], "cover.jpg", { type: "image/jpeg" }));
    const uploaded = await handleAdmin(adminRequest(`/api/admin/listings/${sample.slug}/photos`, marc, {
      method: "POST",
      body: form,
    }), env);
    const uploadedBody = await uploaded.json();
    assert.equal(uploaded.status, 200, JSON.stringify(uploadedBody));
    assert.equal(uploadedBody.photos.at(-1).src.startsWith("/media/photos/"), true);
    const photoId = uploadedBody.photos.at(-1).id;
    const media = await worker.fetch(new Request(`https://www.eatingon30a.com/media/photos/${photoId}`), env);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/jpeg");

    const reordered = await handleAdmin(adminRequest(`/api/admin/listings/${sample.slug}/photos`, marc, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: "30a", photos: [uploadedBody.photos.at(-1), ...uploadedBody.photos.slice(0, -1)] }),
    }), env);
    const reorderedBody = await reordered.json();
    assert.equal(reordered.status, 200, JSON.stringify(reorderedBody));
    assert.equal(reorderedBody.photos[0].id, photoId);
    const covered = await (await worker.fetch(new Request("https://www.eatingon30a.com/data/restaurants.json"), env)).json();
    assert.equal(covered.find((item) => item.slug === sample.slug).image, `/media/photos/${photoId}`);

    const removed = await handleAdmin(adminRequest(`/api/admin/listings/${sample.slug}/photos/${photoId}?site=30a`, marc, {
      method: "DELETE",
    }), env);
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).photos.some((photo) => photo.id === photoId), false);
    const gone = await worker.fetch(new Request(`https://www.eatingon30a.com/media/photos/${photoId}`), env);
    assert.equal(gone.status, 404);

    const created = await handleAdmin(adminRequest("/api/admin/listings", marc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        site: "30a",
        status: "live",
        name: "Pier Test Cafe",
        area: "Destin Harbor",
        notes: "Coffee on the harbor.",
        meals: ["Breakfast"],
        cuisines: ["Cafe"],
      }),
    }), env);
    const createdBody = await created.json();
    assert.equal(created.status, 200, JSON.stringify(createdBody));
    assert.equal(createdBody.listing.payload.area, "Destin Harbor");
    const createdPage = await worker.fetch(new Request(`https://www.eatingon30a.com/restaurants/${createdBody.listing.slug}/`), env);
    assert.match(await createdPage.text(), /Pier Test Cafe/);

    const destin = await handleAdmin(adminRequest("/api/admin/listings", marc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        site: "destin",
        status: "draft",
        name: "Harbor Test Grill",
        area: "Destin Harbor",
      }),
    }), env);
    const destinBody = await destin.json();
    assert.equal(destin.status, 200, JSON.stringify(destinBody));
    const destinList = await (await handleAdmin(adminRequest("/api/admin/listings?site=destin", marc), env)).json();
    assert.equal(destinList.listings.some((item) => item.slug === destinBody.listing.slug && item.status === "draft"), true);
    const still30a = await (await worker.fetch(new Request("https://www.eatingon30a.com/data/restaurants.json"), env)).json();
    assert.equal(still30a.some((item) => item.slug === destinBody.listing.slug), false);

    const deniedSeo = await handleAdmin(adminRequest(`/api/admin/listings/${sample.slug}`, marc, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...sample, site: "30a", seo: "nope" }),
    }), env);
    assert.equal(deniedSeo.status, 400);
    assert.match((await deniedSeo.json()).error, /SEO/);

    const guest = await signIn(db, env, "guest@example.com");
    const guestMe = await (await handleAccount(adminRequest("/api/account/me", guest), env)).json();
    assert.equal(guestMe.user.isAdmin, false);
    const forbidden = await handleAdmin(adminRequest("/api/admin/listings?site=30a", guest), env);
    assert.equal(forbidden.status, 403);
    const saved = await handleAccount(adminRequest("/api/account/saves", guest, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "bud-and-alleys-seaside",
        name: "Bud & Alley's",
        area: "Seaside",
        kind: "favorite",
        saved: true,
      }),
    }), env);
    assert.equal(saved.status, 200);
    const places = await (await handleAccount(adminRequest("/api/account/saves", guest), env)).json();
    assert.equal(places.saves.some((item) => item.kind === "favorite" && item.slug === "bud-and-alleys-seaside"), true);

    const removedListing = await handleAdmin(adminRequest(`/api/admin/listings/${createdBody.listing.slug}?site=30a`, marc, {
      method: "DELETE",
    }), env);
    assert.equal(removedListing.status, 200);
    const afterDelete = await (await worker.fetch(new Request("https://www.eatingon30a.com/data/restaurants.json"), env)).json();
    assert.equal(afterDelete.some((item) => item.slug === createdBody.listing.slug), false);
  });

  test("deactivate and reactivate hide a listing and redirect its URL to the town page", async () => {
    invalidateCatalog();
    resetLimits();
    const db = memoryDb();
    const bucket = memoryBucket();
    const env = siteEnv(db, bucket, { assets: "disk" });
    env.PHOTOS = bucket;
    const marc = await signIn(db, env, "marc@whpinc.com");
    const target = baseline.find((item) => item.slug === "seagrove-village-market-cafe-seagrove-beach");
    assert.ok(target, "baseline should include Seagrove Village Market Café");

    const deactivated = await handleAdmin(adminRequest(`/api/admin/listings/${target.slug}/active`, marc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: "30a", active: false }),
    }), env);
    assert.equal(deactivated.status, 200, JSON.stringify(await deactivated.clone().json()));

    const hiddenPage = await worker.fetch(new Request(`https://www.eatingon30a.com/restaurants/${target.slug}/`), env);
    assert.equal(hiddenPage.status, 301);
    assert.equal(hiddenPage.headers.get("location"), `https://www.eatingon30a.com/areas/${target.areaSlug}/`);

    const hiddenJson = await (await worker.fetch(new Request("https://www.eatingon30a.com/data/restaurants.json"), env)).json();
    assert.equal(hiddenJson.some((item) => item.slug === target.slug), false);

    const townPage = await worker.fetch(new Request("https://www.eatingon30a.com/areas/seagrove-beach/"), env);
    assert.equal(townPage.status, 200);
    const townHtml = await townPage.text();
    assert.equal(townHtml.includes(target.slug), false);
    assert.equal(townHtml.includes(`id="r-${target.slug}"`), false);
    assert.match(townHtml, /Restaurants in Seagrove Beach/);
    assert.equal(townHtml.includes("Seagrove Village Market"), false);

    const hiddenSitemap = await worker.fetch(new Request("https://www.eatingon30a.com/sitemap.xml"), env);
    assert.equal(hiddenSitemap.status, 200);
    const sitemapXml = await hiddenSitemap.text();
    assert.equal(sitemapXml.includes(`/restaurants/${target.slug}/`), false);

    const adminList = await (await handleAdmin(adminRequest("/api/admin/listings?site=30a", marc), env)).json();
    const row = adminList.listings.find((item) => item.slug === target.slug);
    assert.equal(row.status, "inactive");

    const reactivated = await handleAdmin(adminRequest(`/api/admin/listings/${target.slug}/active`, marc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: "30a", active: true }),
    }), env);
    assert.equal(reactivated.status, 200);

    const liveJson = await (await worker.fetch(new Request("https://www.eatingon30a.com/data/restaurants.json"), env)).json();
    assert.equal(liveJson.some((item) => item.slug === target.slug), true);
    const livePage = await worker.fetch(new Request(`https://www.eatingon30a.com/restaurants/${target.slug}/`), env);
    assert.equal(livePage.status, 200);
  });

  test("an override with no name and no baseline does not crash the merge", () => {
    const merged = mergeCatalog([], [
      { slug: "seagrove-village-market-cafe-seagrove-beach", status: "inactive", deleted: false, payload: {} },
      { slug: "the-daytrader-tiki-bar-and-restaurant-seaside", status: "live", deleted: false, payload: { name: "The Daytrader Tiki Bar & Restaurant", area: "Seaside" } },
    ]);
    assert.equal(merged.length, 2);
    const cafe = merged.find((item) => item.slug === "seagrove-village-market-cafe-seagrove-beach");
    assert.equal(cafe.name, "");
    assert.equal(cafe.status, "inactive");
  });

  test("each admin can load the other guide, and a failed sister catalog stays JSON", async () => {
    invalidateCatalog();
    resetLimits();
    const db = memoryDb();
    const bucket = memoryBucket();
    const daytrader = {
      slug: "the-daytrader-tiki-bar-and-restaurant-seaside",
      name: "The Daytrader Tiki Bar & Restaurant",
      area: "Seaside",
    };
    const harbor = { slug: "harbor-baseline", name: "Harbor Baseline", area: "Destin Harbor" };
    const fromDestin = siteEnv(db, bucket);
    fromDestin.ACCOUNT_SITE = "destin";
    let fetched = [];
    fromDestin.CATALOG_FETCH = async (url) => {
      fetched.push(String(url));
      return jsonCatalog([
        daytrader,
        { slug: "seagrove-village-market-cafe-seagrove-beach", name: "Seagrove Village Market Café", area: "Seagrove Beach" },
      ]);
    };
    const marc = await signIn(db, fromDestin, "marc@whpinc.com");
    await db.prepare(
      "INSERT INTO listings (site, slug, status, deleted, payload, updated_at, updated_by) VALUES (?, ?, 'inactive', 0, '{}', 0, 'migration')",
    ).bind("30a", "seagrove-village-market-cafe-seagrove-beach").run();
    const anonymous = await handleAdmin(adminRequest("/api/admin/listings?site=30a"), fromDestin);
    assert.equal(anonymous.status, 401);
    assert.equal(fetched.length, 0);
    const switched = await handleAdmin(adminRequest("/api/admin/listings?site=30a", marc), fromDestin);
    const switchedBody = await switched.json();
    assert.equal(switched.status, 200, JSON.stringify(switchedBody));
    assert.equal(switched.headers.get("content-type").includes("json"), true);
    const found = switchedBody.listings.find((item) => item.slug === daytrader.slug);
    assert.equal(found.name, daytrader.name);
    assert.equal(found.area, "Seaside");
    assert.equal(found.status, "live");
    const cafe = switchedBody.listings.find((item) => item.slug === "seagrove-village-market-cafe-seagrove-beach");
    assert.equal(cafe.status, "inactive");
    assert.equal(cafe.name, "Seagrove Village Market Café");
    assert.ok(fetched.some((url) => url === "https://www.eatingon30a.com/data/catalog.json"));

    invalidateCatalog();
    const from30a = siteEnv(db, bucket);
    from30a.CATALOG_FETCH = async (url) => {
      assert.equal(url, "https://www.eatingindestin.com/data/catalog.json");
      return jsonCatalog([harbor]);
    };
    const marc30a = await signIn(db, from30a, "marc@whpinc.com");
    const otherWay = await handleAdmin(adminRequest("/api/admin/listings?site=destin", marc30a), from30a);
    const otherBody = await otherWay.json();
    assert.equal(otherWay.status, 200, JSON.stringify(otherBody));
    assert.equal(otherBody.listings.some((item) => item.slug === harbor.slug && item.name === harbor.name), true);
    const local = await handleAdmin(adminRequest("/api/admin/listings?site=30a", marc30a), from30a);
    const localBody = await local.json();
    assert.equal(local.status, 200);
    assert.equal(localBody.listings.some((item) => item.slug === daytrader.slug), true);

    invalidateCatalog();
    from30a.CATALOG_FETCH = async () => new Response("<html>challenge</html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    });
    const blocked = await handleAdmin(adminRequest("/api/admin/listings?site=destin", marc30a), from30a);
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 503);
    assert.equal(blocked.headers.get("content-type").includes("json"), true);
    assert.match(blockedBody.error, /Eating in Destin listings could not be loaded/);
    const guest = await signIn(db, from30a, "guest@example.com");
    const forbidden = await handleAdmin(adminRequest("/api/admin/listings?site=destin", guest), from30a);
    assert.equal(forbidden.status, 403);
  });
});
