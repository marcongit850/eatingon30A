import assert from "node:assert/strict";
import test from "node:test";
import listingOptions from "../data/listing-form.json" with { type: "json" };
import worker, {
  deliverListRestaurant,
  formatListRestaurant,
  handleListRestaurant,
  honeypotTripped,
  limitListRestaurant,
  parseListRestaurant,
  resetListRestaurantLimits,
} from "../worker.js";

function base(overrides = {}) {
  const body = {
    eo30a_hp: "",
    name: "Jamie Cook",
    role: "owner",
    email: "jamie@example.com",
    contactPhone: "(850) 555-0100",
    bestTime: "Mornings",
    intent: "new",
    existingListing: "",
    restaurant: "Jamie's Porch",
    area: listingOptions.areas[0],
    address: "1 County Road 30A, Santa Rosa Beach, FL 32459",
    restaurantPhone: "(850) 555-0199",
    website: "https://example.com",
    price: "$$",
    description: "A casual porch spot for grilled fish and a cold drink. Families sit outside when the weather is kind.",
    seasonalNote: "Winter hours start after Thanksgiving.",
    cuisines: [listingOptions.cuisines[0]],
    meals: ["Dinner", "Late night"],
    foods: [listingOptions.foods[0]],
    facebook: "https://facebook.com/example",
    instagram: "@jamiesporch",
    logoUrl: "https://example.com/logo.png",
    listPhotoUrl: "https://example.com/list.jpg",
    detailPhotoUrl: "https://example.com/detail.jpg",
    videoUrl: "",
    notes: "Please call before you visit.",
    authorized: true,
  };
  for (const day of listingOptions.days) {
    body[day.hours] = day.label === "Monday" ? "11am to 9pm" : "";
    body[day.closed] = day.label !== "Monday";
  }
  for (const item of listingOptions.amenities) body[item.name] = item.name === "music" || item.name === "outdoor";
  return { ...body, ...overrides };
}

test("parseListRestaurant requires the fields a listing needs", () => {
  assert.equal(parseListRestaurant(null).error, "Send the request as JSON.");
  assert.equal(parseListRestaurant({}).error, "Enter your name.");
  assert.equal(parseListRestaurant(base({ role: "chef" })).error, "Choose your role.");
  assert.equal(parseListRestaurant(base({ email: "nope" })).error, "Enter a valid email.");
  assert.equal(parseListRestaurant(base({ intent: "edit" })).error, "Choose new listing or an update.");
  assert.equal(
    parseListRestaurant(base({ intent: "update", existingListing: "" })).error,
    "Add the current listing URL or the exact restaurant name.",
  );
  assert.equal(parseListRestaurant(base({ area: "Destin" })).error, "Choose an area.");
  assert.equal(parseListRestaurant(base({ price: "free" })).error, "Choose a price range.");
  assert.equal(parseListRestaurant(base({ description: "  " })).error, "Add a short description.");
  assert.equal(parseListRestaurant(base({ hoursMon: "", hoursMonClosed: false })).error, "Add hours for Monday, or mark it closed.");
  assert.equal(parseListRestaurant(base({ cuisines: [] })).error, "Choose at least one cuisine type.");
  assert.equal(parseListRestaurant(base({ cuisines: ["Not a cuisine"] })).error, "Choose cuisine types from the list.");
  assert.equal(parseListRestaurant(base({ meals: [] })).error, "Choose at least one meal.");
  assert.equal(parseListRestaurant(base({ foods: ["Not a food"] })).error, "Choose food styles from the list.");
  assert.equal(parseListRestaurant(base({ restaurantPhone: "call me" })).error, "Enter the restaurant phone number.");
  assert.equal(parseListRestaurant(base({ website: "not a link with spaces" })).error, "Check the website link.");
  assert.equal(parseListRestaurant(base({ authorized: false })).error, "Confirm you are authorized to submit for this restaurant.");
  assert.equal(parseListRestaurant(base({ name: "x".repeat(121) })).error, "Keep your name under 120 characters.");
  const parsed = parseListRestaurant(base());
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.roleLabel, "Owner");
  assert.equal(parsed.value.intentLabel, "New listing");
  assert.equal(parsed.value.hours[0].value, "11am to 9pm");
  assert.equal(parsed.value.hours[1].value, "Closed");
  assert.equal(parsed.value.amenities.find((item) => item.label === "Live music").value, "Yes");
  assert.equal(parsed.value.amenities.find((item) => item.label === "Reservations").value, "No");
});

test("an update with a listing reference is accepted", () => {
  const parsed = parseListRestaurant(
    base({
      intent: "update",
      existingListing: "https://www.eatingon30a.com/restaurants/o-ku-alys-beach/",
      restaurant: "O-Ku",
    }),
  );
  assert.equal(parsed.value.intentLabel, "Update an existing listing");
  assert.match(parsed.value.existingListing, /o-ku-alys-beach/);
});

test("the listing email labels every field", async () => {
  const payload = parseListRestaurant(base({ intent: "update", existingListing: "O-Ku" })).value;
  const text = formatListRestaurant(payload);
  for (const label of [
    "Your name: Jamie Cook",
    "Role: Owner",
    "Email: jamie@example.com",
    "Phone: (850) 555-0100",
    "Best time to reach you: Mornings",
    "Request: Update an existing listing",
    "Current listing: O-Ku",
    "Restaurant name: Jamie's Porch",
    "Street address: 1 County Road 30A, Santa Rosa Beach, FL 32459",
    "Price range: $$",
    "Monday: 11am to 9pm",
    "Tuesday: Closed",
    "Seasonal note: Winter hours start after Thanksgiving.",
    "Meals: Dinner, Late night",
    "Outdoor dining: Yes",
    "Happy hour (drinks): No",
    "Happy hour (food): No",
    "Kid friendly: No",
    "Groups of 12+: No",
    "Live music: Yes",
    "Facebook URL: https://facebook.com/example",
    "Instagram: @jamiesporch",
    "Logo URL: https://example.com/logo.png",
    "List photo URL: https://example.com/list.jpg",
    "Detail photo URL: https://example.com/detail.jpg",
    "Video URL: Not provided",
    "Authorized to submit: Yes",
  ]) {
    assert.ok(text.includes(label), label);
  }
  assert.equal(text.includes("—"), false);
  assert.equal(text.includes("–"), false);

  let init = null;
  const result = await deliverListRestaurant(
    payload,
    {
      RESEND_API_KEY: "re_test",
      CONTACT_EMAIL: "marc@example.com",
      SUBSCRIBE_FROM: "Eating on 30A <listings@example.com>",
    },
    (_url, nextInit) => {
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(result.delivered, true);
  const mail = JSON.parse(init.body);
  assert.equal(mail.reply_to, "jamie@example.com");
  assert.deepEqual(mail.to, ["marc@example.com"]);
  assert.equal(mail.subject, "Eating on 30A restaurant form: Update an existing listing, Jamie's Porch");
  assert.equal(mail.subject.includes("—"), false);
  assert.match(mail.text, /Short description:\nA casual porch spot/);
  assert.match(mail.text, /Notes:\nPlease call before you visit\./);
});

test("missing secrets accept the listing form and do not call Resend", async () => {
  let called = false;
  const result = await deliverListRestaurant(parseListRestaurant(base()).value, {}, () => {
    called = true;
    return Promise.resolve(new Response(""));
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false });
});

test("a filled honeypot is accepted and not emailed", async () => {
  resetListRestaurantLimits();
  assert.equal(honeypotTripped({ eo30a_hp: "spam inc" }), true);
  let called = false;
  const request = new Request("https://eatingon30a.example/api/list-restaurant", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.20" },
    body: JSON.stringify(base({ eo30a_hp: "https://spam.example" })),
  });
  const response = await handleListRestaurant(
    request,
    {
      RESEND_API_KEY: "re_test",
      CONTACT_EMAIL: "marc@example.com",
      SUBSCRIBE_FROM: "Eating on 30A <listings@example.com>",
    },
    () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(called, false);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false });
});

test("the listing form rate limit answers after five posts from one address", () => {
  resetListRestaurantLimits();
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  for (let i = 0; i < 5; i += 1) assert.equal(limitListRestaurant("203.0.113.8", now + i), false);
  assert.equal(limitListRestaurant("203.0.113.8", now + 6), true);
  assert.equal(limitListRestaurant("203.0.113.9", now + 6), false);
});

test("POST JSON without secrets returns delivered false", async () => {
  resetListRestaurantLimits();
  const request = new Request("https://eatingon30a.example/api/list-restaurant", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.30" },
    body: JSON.stringify(base()),
  });
  const response = await handleListRestaurant(request, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false });
});

test("a listing form post returns an HTML thanks page", async () => {
  resetListRestaurantLimits();
  const body = base();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (typeof value === "boolean") {
      if (value) params.append(key, "yes");
    } else if (value) {
      params.append(key, value);
    }
  }
  const request = new Request("https://eatingon30a.example/api/list-restaurant", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.31" },
    body: params,
  });
  const response = await handleListRestaurant(request, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your listing\./);
});

test("a non-POST listing form request is rejected", async () => {
  const request = new Request("https://eatingon30a.example/api/list-restaurant");
  const response = await handleListRestaurant(request, {});
  assert.equal(response.status, 405);
});

test("the worker routes /api/list-restaurant without touching static assets", async () => {
  resetListRestaurantLimits();
  let assets = false;
  const request = new Request("https://eatingon30a.example/api/list-restaurant", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.40" },
    body: JSON.stringify(base()),
  });
  const response = await worker.fetch(request, {
    ASSETS: {
      fetch() {
        assets = true;
        return Promise.resolve(new Response("asset"));
      },
    },
  });
  assert.equal(assets, false);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false });
});
