import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { describeFilters, filtersFromParams, matches, spreadOverlaps } from "../site.js";

const restaurants = JSON.parse(readFileSync(new URL("../data/restaurants.json", import.meta.url), "utf8"));

const blank = { meal: "", area: "", cuisine: "", q: "", outdoor: "", kids: "", music: "" };

test("empty filters keep the full directory", () => {
  assert.equal(restaurants.filter((item) => matches(item, blank)).length, restaurants.length);
  assert.ok(restaurants.length >= 100);
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

test("stacked pins at the same coordinate are pulled apart", () => {
  const placed = spreadOverlaps([
    { slug: "a", lat: 30.35, lng: -86.25 },
    { slug: "b", lat: 30.35, lng: -86.25 },
  ]);
  assert.equal(placed.length, 2);
  assert.notEqual(placed[0].pinLat, placed[1].pinLat);
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
