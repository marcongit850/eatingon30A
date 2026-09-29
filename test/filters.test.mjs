import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { describeFilters, featuredIndex, filtersFromParams, mapListCard, markerPopup, matches, monogram, spreadOverlaps, stepFeatured } from "../site.js";

const restaurants = JSON.parse(readFileSync(new URL("../data/restaurants.json", import.meta.url), "utf8"));

const blank = { meal: "", area: "", cuisine: "", q: "", outdoor: "", kids: "", music: "" };

test("empty filters keep the full directory", () => {
  assert.equal(restaurants.filter((item) => matches(item, blank)).length, restaurants.length);
  assert.equal(restaurants.length, 114);
});

test("homepage meal and town query strings filter the directory", () => {
  const dinner = filtersFromParams(new URLSearchParams("meal=Dinner"));
  const dinnerRows = restaurants.filter((item) => matches(item, { ...blank, ...dinner }));
  assert.ok(dinnerRows.length > 0);
  assert.ok(dinnerRows.every((item) => item.meals.includes("Dinner")));
  assert.ok(dinnerRows.length < restaurants.length);

  const seaside = filtersFromParams(new URLSearchParams("area=seaside"));
  const seasideRows = restaurants.filter((item) => matches(item, { ...blank, ...seaside }));
  assert.ok(seasideRows.length > 0);
  assert.ok(seasideRows.every((item) => item.areaSlug === "seaside"));

  const both = filtersFromParams(new URLSearchParams("meal=Dinner&area=seaside"));
  const bothRows = restaurants.filter((item) => matches(item, { ...blank, ...both }));
  assert.ok(bothRows.length > 0);
  assert.ok(bothRows.every((item) => item.areaSlug === "seaside" && item.meals.includes("Dinner")));
  assert.ok(bothRows.length < seasideRows.length || bothRows.length < dinnerRows.length);
});

test("cuisine and search are case insensitive and exact for cuisine", () => {
  const oyster = restaurants.filter((item) => matches(item, { ...blank, q: "OYSTER" }));
  assert.ok(oyster.length > 0);
  const italian = restaurants.filter((item) => matches(item, { ...blank, cuisine: "italian" }));
  assert.ok(italian.length > 0);
  assert.ok(italian.every((item) => item.cuisines.some((cuisine) => cuisine.toLowerCase() === "italian")));
  const miss = restaurants.filter((item) => matches(item, { ...blank, cuisine: "not-a-cuisine" }));
  assert.equal(miss.length, 0);
});

test("amenity filters require a yes flag", () => {
  const outdoor = restaurants.filter((item) => matches(item, { ...blank, outdoor: "yes" }));
  assert.ok(outdoor.length > 0);
  assert.ok(outdoor.every((item) => item.outdoor));
  assert.ok(outdoor.length < restaurants.length);
});

test("every restaurant with coordinates gets its own map pin", () => {
  assert.equal(restaurants.every((item) => typeof item.lat === "number" && typeof item.lng === "number"), true);
  assert.equal(restaurants.every((item) => item.address), true);
  const placed = spreadOverlaps(restaurants);
  assert.equal(placed.length, restaurants.length);
  assert.equal(new Set(placed.map((item) => item.slug)).size, restaurants.length);
});

test("map popups show the name, address, and profile", () => {
  const stinkys = restaurants.find((item) => item.slug === "stinkys-fish-camp-dune-allen-beach");
  const html = markerPopup(stinkys);
  assert.match(html, /Stinky/);
  assert.match(html, /5960 W County Hwy 30A/);
  assert.match(html, /href="\/restaurants\/stinkys-fish-camp-dune-allen-beach\/"/);
  assert.match(html, /class="popup-photo"/);
  assert.match(html, /\/images\/restaurants\/stinkys-fish-camp-dune-allen-beach\/01\.jpg/);

  const oku = restaurants.find((item) => item.slug === "o-ku-alys-beach");
  const okuHtml = markerPopup(oku);
  assert.match(okuHtml, /O-Ku/);
  assert.match(okuHtml, /class="popup-photo"/);
  assert.match(okuHtml, /\/images\/restaurants\/o-ku-alys-beach\/01\.jpg/);

  const plain = restaurants.find((item) => item.slug === "steamboat-grill-30a-seagrove-beach");
  const plainHtml = markerPopup(plain);
  assert.match(plainHtml, /Steamboat/);
  assert.match(plainHtml, /class="popup-address"/);
  assert.doesNotMatch(plainHtml, /popup-photo/);
  assert.match(plainHtml, /href="\/restaurants\/steamboat-grill-30a-seagrove-beach\/"/);
});

test("map list cards stay compact", () => {
  assert.equal(monogram("The Red Bar"), "RB");
  assert.equal(monogram("O-Ku"), "OK");
  assert.equal(monogram("Bud & Alley’s"), "BA");
  const stinkys = restaurants.find((item) => item.slug === "stinkys-fish-camp-dune-allen-beach");
  const photo = mapListCard(stinkys);
  assert.match(photo, /class="map-thumb"/);
  assert.match(photo, /stinkys-fish-camp-dune-allen-beach\/01\.jpg/);
  assert.match(photo, /<strong>Stinky’s Fish Camp<\/strong>/);
  assert.match(photo, /class="map-meta">Dune Allen Beach · \$\$/);
  assert.match(photo, /class="map-address">5960 W County Hwy 30A/);
  const okuCard = mapListCard(restaurants.find((item) => item.slug === "o-ku-alys-beach"));
  assert.match(okuCard, /o-ku-alys-beach\/01\.jpg/);
  assert.doesNotMatch(okuCard, /class="map-thumb ph"/);
  const plain = restaurants.find((item) => item.slug === "steamboat-grill-30a-seagrove-beach");
  const mark = mapListCard(plain);
  assert.match(mark, /class="map-thumb ph"/);
  assert.match(mark, /aria-hidden="true">SG</);
  assert.match(mark, /Seagrove Beach · /);
  assert.doesNotMatch(mark, /<img/);
});

test("stacked pins at the same coordinate are pulled apart", () => {
  const placed = spreadOverlaps([
    { slug: "a", lat: 30.35, lng: -86.25 },
    { slug: "b", lat: 30.35, lng: -86.25 },
  ]);
  assert.equal(placed.length, 2);
  assert.notEqual(placed[0].pinLat, placed[1].pinLat);
});

test("featured cover rotates once per UTC day", () => {
  assert.equal(featuredIndex(4, 0), 0);
  assert.equal(featuredIndex(4, 86400000), 1);
  assert.equal(featuredIndex(4, 86400000 * 5 + 3600000), 1);
  assert.equal(featuredIndex(4, Date.UTC(2026, 8, 29, 0, 30)), featuredIndex(4, Date.UTC(2026, 8, 29, 23, 30)));
  assert.notEqual(featuredIndex(4, Date.UTC(2026, 8, 29)), featuredIndex(4, Date.UTC(2026, 8, 30)));
  assert.equal(featuredIndex(1, 86400000 * 9), 0);
  assert.equal(featuredIndex(0, 86400000), 0);
});

test("featured arrows cycle every listing and wrap", () => {
  assert.equal(stepFeatured(0, 1, 4), 1);
  assert.equal(stepFeatured(3, 1, 4), 0);
  assert.equal(stepFeatured(0, -1, 4), 3);
  assert.equal(stepFeatured(2, -1, 4), 1);
  assert.equal(stepFeatured(featuredIndex(4, Date.UTC(2026, 8, 29)), 1, 4), stepFeatured(featuredIndex(4, Date.UTC(2026, 8, 29, 18)), 1, 4));
  assert.equal(stepFeatured(1, 0, 4), 1);
  assert.equal(stepFeatured(0, 1, 0), 0);
});

test("filter label names the town", () => {
  const label = describeFilters(
    { ...blank, meal: "Breakfast", area: "inlet-beach" },
    { "inlet-beach": "Inlet Beach" }
  );
  assert.equal(label, "Breakfast in Inlet Beach");
});

test("public json does not carry place ids or owner ids", () => {
  const raw = readFileSync(new URL("../data/restaurants.json", import.meta.url), "utf8");
  assert.equal(raw.includes("googlePlaceId"), false);
  assert.equal(raw.includes("ChIJ"), false);
});
