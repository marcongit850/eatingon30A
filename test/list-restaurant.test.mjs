import assert from "node:assert/strict";
import test from "node:test";
import listingOptions from "../data/listing-form.json" with { type: "json" };
import worker, {
  collectListingImages,
  deliverListRestaurant,
  formatListRestaurant,
  handleListRestaurant,
  honeypotTripped,
  limitListRestaurant,
  parseListRestaurant,
  resetListRestaurantLimits,
} from "../worker.js";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

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

test("parseListRestaurant requires a name and email and lets every other field be blank", () => {
  assert.equal(parseListRestaurant(null).error, "Send the request as JSON.");
  assert.equal(parseListRestaurant({}).error, "Enter your name.");
  assert.equal(parseListRestaurant({ name: "Jamie Cook" }).error, "Enter a valid email.");
  assert.equal(parseListRestaurant(base({ name: "" })).error, "Enter your name.");
  assert.equal(parseListRestaurant(base({ email: "" })).error, "Enter a valid email.");
  assert.equal(parseListRestaurant(base({ role: "chef" })).error, "Choose your role.");
  assert.equal(parseListRestaurant(base({ role: "" })).error, undefined);
  assert.equal(parseListRestaurant(base({ email: "nope" })).error, "Enter a valid email.");
  assert.equal(parseListRestaurant(base({ intent: "edit" })).error, "Choose new listing or an update.");
  assert.equal(parseListRestaurant(base({ intent: "" })).error, undefined);
  assert.equal(parseListRestaurant(base({ intent: "update", existingListing: "" })).error, undefined);
  assert.equal(parseListRestaurant(base({ area: "Destin" })).error, "Choose an area.");
  assert.equal(parseListRestaurant(base({ area: "" })).error, undefined);
  assert.equal(parseListRestaurant(base({ price: "free" })).error, "Choose a price range.");
  assert.equal(parseListRestaurant(base({ price: "" })).error, undefined);
  assert.equal(parseListRestaurant(base({ description: "  " })).error, undefined);
  assert.equal(parseListRestaurant(base({ restaurant: "" })).error, undefined);
  assert.equal(parseListRestaurant(base({ address: "" })).error, undefined);
  assert.equal(parseListRestaurant(base({ hoursMon: "", hoursMonClosed: false })).error, undefined);
  assert.equal(parseListRestaurant(base({ cuisines: [] })).error, undefined);
  assert.equal(parseListRestaurant(base({ cuisines: ["Not a cuisine"] })).error, "Choose cuisine types from the list.");
  assert.equal(parseListRestaurant(base({ meals: [] })).error, undefined);
  assert.equal(parseListRestaurant(base({ foods: ["Not a food"] })).error, "Choose food styles from the list.");
  assert.equal(parseListRestaurant(base({ restaurantPhone: "call me" })).error, "Enter the restaurant phone number.");
  assert.equal(parseListRestaurant(base({ restaurantPhone: "" })).error, undefined);
  assert.equal(parseListRestaurant(base({ website: "not a link with spaces" })).error, "Check the website link.");
  assert.equal(parseListRestaurant(base({ authorized: false })).value.authorized, false);
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

test("a name and email are enough to send the listing email", async () => {
  const parsed = parseListRestaurant({ name: "Jamie Cook", email: "jamie@example.com" });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.authorized, false);
  assert.equal(parsed.value.hours.every((day) => day.value === ""), true);
  const text = formatListRestaurant(parsed.value);
  for (const label of [
    "Your name: Jamie Cook",
    "Role: Not provided",
    "Email: jamie@example.com",
    "Request: Not provided",
    "Restaurant name: Not provided",
    "Area: Not provided",
    "Street address: Not provided",
    "Price range: Not provided",
    "Monday: Not provided",
    "Cuisine types: Not provided",
    "Meals: Not provided",
    "Authorized to submit: No",
  ]) {
    assert.ok(text.includes(label), label);
  }
  let init = null;
  const result = await deliverListRestaurant(
    parsed.value,
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
  assert.equal(mail.subject, "Eating on 30A restaurant form");
  assert.equal(mail.subject.includes("—"), false);
  assert.equal(mail.subject.includes("–"), false);
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
    "Video URL: Not provided",
    "Images: Not provided",
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
  assert.equal(mail.attachments, undefined);
  assert.match(mail.text, /Short description:\nA casual porch spot/);
  assert.match(mail.text, /Notes:\nPlease call before you visit\./);
});

test("old photo URL fields are ignored and not published", () => {
  const parsed = parseListRestaurant(base({
    logoUrl: "https://example.com/logo.png",
    listPhotoUrl: "https://example.com/list.jpg",
    detailPhotoUrl: "https://example.com/detail.jpg",
  }));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.logoUrl, undefined);
  const text = formatListRestaurant(parsed.value);
  assert.equal(text.includes("logo.png"), false);
  assert.equal(text.includes("list.jpg"), false);
  assert.equal(text.includes("detail.jpg"), false);
});

function imageFile(name, bytes, type = "") {
  return new File([bytes], name, { type });
}

function formRequest(files, ip, overrides = {}) {
  const body = base(overrides);
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
    } else if (typeof value === "boolean") {
      if (value) form.append(key, "yes");
    } else if (value) {
      form.append(key, String(value));
    }
  }
  for (const file of files) form.append("photos", file, file.name);
  return new Request("https://eatingon30a.example/api/list-restaurant", {
    method: "POST",
    headers: { accept: "application/json", "cf-connecting-ip": ip },
    body: form,
  });
}

const mailEnv = {
  RESEND_API_KEY: "re_test",
  CONTACT_EMAIL: "marc@example.com",
  SUBSCRIBE_FROM: "Eating on 30A <listings@example.com>",
};

test("jpeg, png, and webp files are attached to the listing email", async () => {
  resetListRestaurantLimits();
  const files = [
    imageFile("Logo.JPG", JPEG, "image/jpeg"),
    imageFile("list photo.png", PNG, "image/png"),
    imageFile("detail.webp", WEBP, "image/webp"),
  ];
  let init = null;
  let calls = 0;
  const response = await handleListRestaurant(formRequest(files, "203.0.113.51"), mailEnv, (url, nextInit) => {
    calls += 1;
    init = nextInit;
    assert.equal(url, "https://api.resend.com/emails");
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: true });
  assert.equal(calls, 1);
  const mail = JSON.parse(init.body);
  assert.equal(mail.text.includes("Images: Logo.jpg, list-photo.png, detail.webp"), true);
  assert.equal(mail.text.includes("—"), false);
  assert.equal(mail.text.includes("–"), false);
  assert.deepEqual(mail.attachments.map((item) => item.filename), ["Logo.jpg", "list-photo.png", "detail.webp"]);
  assert.deepEqual(mail.attachments.map((item) => item.content_type), ["image/jpeg", "image/png", "image/webp"]);
  assert.equal(mail.attachments[0].content, Buffer.from(JPEG).toString("base64"));
  assert.equal(mail.attachments[1].content, Buffer.from(PNG).toString("base64"));
  assert.equal(JSON.stringify(mail).includes("/images/"), false);
});

test("other file types and oversized images are rejected", async () => {
  resetListRestaurantLimits();
  const gif = await handleListRestaurant(
    formRequest([imageFile("anim.gif", GIF, "image/gif")], "203.0.113.52"),
    mailEnv,
    () => Promise.resolve(new Response("{}", { status: 200 })),
  );
  assert.equal(gif.status, 400);
  assert.equal((await gif.json()).error, "Use a JPEG, PNG, or WebP image.");

  resetListRestaurantLimits();
  const fake = await handleListRestaurant(
    formRequest([imageFile("logo.jpg", Uint8Array.from([1, 2, 3, 4]), "image/jpeg")], "203.0.113.53"),
    mailEnv,
    () => Promise.resolve(new Response("{}", { status: 200 })),
  );
  assert.equal(fake.status, 400);
  assert.equal((await fake.json()).error, "Use a JPEG, PNG, or WebP image.");

  resetListRestaurantLimits();
  const big = new Uint8Array(2 * 1024 * 1024 + 1);
  big[0] = 0xff;
  big[1] = 0xd8;
  big[2] = 0xff;
  const oversized = await handleListRestaurant(
    formRequest([imageFile("big.jpg", big, "image/jpeg")], "203.0.113.54"),
    mailEnv,
    () => Promise.resolve(new Response("{}", { status: 200 })),
  );
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).error, "That file is too large. Keep each image under 2 MB.");

  const chunk = new Uint8Array(2 * 1024 * 1024);
  chunk[0] = 0xff;
  chunk[1] = 0xd8;
  chunk[2] = 0xff;
  const packed = await collectListingImages([
    imageFile("hero.jpg", chunk, "image/jpeg"),
    imageFile("hero.jpg", chunk, "image/jpeg"),
    imageFile("hero.jpg", chunk, "image/jpeg"),
    imageFile("hero.jpg", chunk, "image/jpeg"),
    imageFile("extra.jpg", JPEG, "image/jpeg"),
  ]);
  assert.equal(packed.error, "Those images are too large to send. Keep them under 8 MB altogether.");
  const one = await collectListingImages([imageFile("hero.jpg", chunk, "image/jpeg")]);
  assert.equal(one.files[0].content, Buffer.from(chunk).toString("base64"));

  const collected = await collectListingImages([
    imageFile("one.jpg", JPEG, "image/jpeg"),
    imageFile("two.jpg", JPEG, "image/jpeg"),
    imageFile("three.jpg", JPEG, "image/jpeg"),
    imageFile("four.jpg", JPEG, "image/jpeg"),
    imageFile("five.jpg", JPEG, "image/jpeg"),
    imageFile("six.jpg", JPEG, "image/jpeg"),
    imageFile("seven.jpg", JPEG, "image/jpeg"),
    imageFile("eight.jpg", JPEG, "image/jpeg"),
    imageFile("nine.jpg", JPEG, "image/jpeg"),
    imageFile("ten.jpg", JPEG, "image/jpeg"),
    imageFile("eleven.jpg", JPEG, "image/jpeg"),
    imageFile("twelve.jpg", JPEG, "image/jpeg"),
    imageFile("thirteen.jpg", JPEG, "image/jpeg"),
  ]);
  assert.equal(collected.error, "Keep it to 12 images.");
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
  assert.match(await response.text(), /Thanks!  We will review and get back to you shortly\./);
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
