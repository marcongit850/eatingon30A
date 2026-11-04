import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { addPhoto, createListing, deleteListing, setListingActive, updateListing } from "../accounts/listings.js";
import { LISTINGS_SQL } from "../accounts/schema.js";
import { mergeCatalog } from "../catalog.js";

const SITES = ["30a", "destin"];
const EMAIL = "marc@whpinc.com";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xd9]);

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(LISTINGS_SQL);
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
    async delete(key) {
      objects.delete(key);
    },
    objects,
  };
}

function listingBody(site, extra = {}) {
  return { site, name: "Pier Test", area: "Seaside", ...extra };
}

async function stored(db, site, slug) {
  const row = await db.prepare("SELECT payload, status FROM listings WHERE site = ? AND slug = ?").bind(site, slug).first();
  assert.ok(row, `missing ${site}/${slug}`);
  return { payload: JSON.parse(row.payload), status: row.status };
}

async function save(db, site, extra) {
  const response = await updateListing(db, {}, "pier-test", listingBody(site, extra), EMAIL);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return stored(db, site, "pier-test");
}

test("updateListing keeps stored waterfront and bar when the request omits them", async () => {
  for (const site of SITES) {
    const db = memoryDb();
    await save(db, site, { waterfront: true, bar: true });
    const row = await save(db, site, { area: "Grayton Beach", nickname: "drop me" });
    assert.equal(row.payload.waterfront, true);
    assert.equal(row.payload.bar, true);
    assert.equal(row.payload.area, "Grayton Beach");
    assert.equal(Object.hasOwn(row.payload, "nickname"), false);
  }
});

test("updateListing clears waterfront and bar on an explicit false", async () => {
  for (const site of SITES) {
    const db = memoryDb();
    await save(db, site, { waterfront: true, bar: true });
    const row = await save(db, site, { waterfront: false });
    assert.equal(row.payload.waterfront, false);
    assert.equal(row.payload.bar, true);
    const merged = mergeCatalog(
      [{ slug: "pier-test", name: "Pier Test", area: "Seaside", waterfront: true, bar: true }],
      [{ slug: "pier-test", status: "live", deleted: false, payload: row.payload }],
    );
    assert.equal(merged[0].waterfront, false);
    assert.equal(merged[0].bar, true);
  }
});

test("updateListing sets waterfront and bar on an explicit true", async () => {
  for (const site of SITES) {
    const db = memoryDb();
    await save(db, site, { waterfront: false, bar: false });
    const row = await save(db, site, { bar: true });
    assert.equal(row.payload.waterfront, false);
    assert.equal(row.payload.bar, true);
    const both = await save(db, site, { waterfront: true, bar: true });
    assert.equal(both.payload.waterfront, true);
    assert.equal(both.payload.bar, true);
  }
});

test("setListingActive keeps stored waterfront and bar when the request omits them", async () => {
  for (const site of SITES) {
    const db = memoryDb();
    await save(db, site, { waterfront: true, bar: true });
    const response = await setListingActive(db, site, "pier-test", false, listingBody(site), EMAIL);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const row = await stored(db, site, "pier-test");
    assert.equal(row.status, "inactive");
    assert.equal(row.payload.waterfront, true);
    assert.equal(row.payload.bar, true);
  }
});

test("setListingActive clears waterfront and bar on an explicit false", async () => {
  for (const site of SITES) {
    const db = memoryDb();
    await save(db, site, { waterfront: true, bar: true });
    const response = await setListingActive(db, site, "pier-test", false, listingBody(site, { waterfront: false, bar: false }), EMAIL);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const row = await stored(db, site, "pier-test");
    assert.equal(row.payload.waterfront, false);
    assert.equal(row.payload.bar, false);
  }
});

test("setListingActive sets waterfront and bar on an explicit true", async () => {
  for (const site of SITES) {
    const db = memoryDb();
    await save(db, site, { waterfront: false, bar: false });
    const response = await setListingActive(db, site, "pier-test", true, listingBody(site, { waterfront: true, bar: true }), EMAIL);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const row = await stored(db, site, "pier-test");
    assert.equal(row.status, "live");
    assert.equal(row.payload.waterfront, true);
    assert.equal(row.payload.bar, true);
  }
});

test("a first write leaves missing waterfront and bar absent so catalog merge uses the CSV baseline", async () => {
  for (const site of SITES) {
    const db = memoryDb();
    const created = await createListing(db, listingBody(site, { name: "New Pier" }), EMAIL);
    assert.equal(created.status, 200, JSON.stringify(await created.clone().json()));
    const createdBody = await created.json();
    assert.equal(Object.hasOwn(createdBody.listing.payload, "waterfront"), false);
    assert.equal(Object.hasOwn(createdBody.listing.payload, "bar"), false);

    const updated = await updateListing(db, {}, "fresh-pier", listingBody(site, { name: "Fresh Pier" }), EMAIL);
    assert.equal(updated.status, 200);
    const updatedRow = await stored(db, site, "fresh-pier");
    assert.equal(Object.hasOwn(updatedRow.payload, "waterfront"), false);
    assert.equal(Object.hasOwn(updatedRow.payload, "bar"), false);
    const merged = mergeCatalog(
      [{ slug: "fresh-pier", name: "Fresh Pier", area: "Seaside", waterfront: true, bar: true }],
      [{ slug: "fresh-pier", status: "live", deleted: false, payload: updatedRow.payload }],
    );
    assert.equal(merged[0].waterfront, true);
    assert.equal(merged[0].bar, true);

    const activated = await setListingActive(db, site, "brand-new", true, listingBody(site, { name: "Brand New" }), EMAIL);
    assert.equal(activated.status, 200, JSON.stringify(await activated.clone().json()));
    const activatedRow = await stored(db, site, "brand-new");
    assert.equal(Object.hasOwn(activatedRow.payload, "waterfront"), false);
    assert.equal(Object.hasOwn(activatedRow.payload, "bar"), false);
  }
});

test("an existing row without the flags stays without them when the request omits them", async () => {
  for (const site of SITES) {
    const db = memoryDb();
    await save(db, site, {});
    let row = await stored(db, site, "pier-test");
    assert.equal(Object.hasOwn(row.payload, "waterfront"), false);
    await save(db, site, { name: "Pier Test Revised" });
    row = await stored(db, site, "pier-test");
    assert.equal(row.payload.name, "Pier Test Revised");
    assert.equal(Object.hasOwn(row.payload, "waterfront"), false);
    assert.equal(Object.hasOwn(row.payload, "bar"), false);
    const response = await setListingActive(db, site, "pier-test", false, listingBody(site, { name: "Pier Test Revised" }), EMAIL);
    assert.equal(response.status, 200);
    row = await stored(db, site, "pier-test");
    assert.equal(Object.hasOwn(row.payload, "waterfront"), false);
    assert.equal(Object.hasOwn(row.payload, "bar"), false);
  }
});

test("waterfront and bar still reject a non-boolean and drop unknown keys", async () => {
  const db = memoryDb();
  await save(db, "30a", { waterfront: true, bar: true });
  const rejected = await updateListing(db, {}, "pier-test", listingBody("30a", { waterfront: "maybe" }), EMAIL);
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /waterfront/);
  const kept = await stored(db, "30a", "pier-test");
  assert.equal(kept.payload.waterfront, true);
  const accepted = await updateListing(db, {}, "pier-test", listingBody("30a", { waterfront: "yes", bar: "no", extra: "nope" }), EMAIL);
  assert.equal(accepted.status, 200);
  const row = await stored(db, "30a", "pier-test");
  assert.equal(row.payload.waterfront, true);
  assert.equal(row.payload.bar, false);
  assert.equal(Object.hasOwn(row.payload, "extra"), false);
});

test("photo and delete writes keep stored waterfront and bar", async () => {
  const db = memoryDb();
  const bucket = memoryBucket();
  await save(db, "destin", { waterfront: true, bar: true });
  const added = await addPhoto(db, { PHOTOS: bucket }, "destin", "pier-test", JPEG);
  assert.equal(added.status, 200, JSON.stringify(await added.clone().json()));
  let row = await stored(db, "destin", "pier-test");
  assert.equal(row.payload.waterfront, true);
  assert.equal(row.payload.bar, true);
  assert.equal(row.payload.photos.length, 1);
  const removed = await deleteListing(db, { PHOTOS: bucket }, "destin", "pier-test", EMAIL);
  assert.equal(removed.status, 200);
  row = await stored(db, "destin", "pier-test");
  assert.equal(row.payload.waterfront, true);
  assert.equal(row.payload.bar, true);
});
