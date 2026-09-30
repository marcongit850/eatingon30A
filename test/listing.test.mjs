import assert from "node:assert/strict";
import test from "node:test";
import worker, { deliverListing, handleListing, parseListing } from "../worker.js";

const note = {
  restaurant: "Bud & Alley's",
  type: "update",
  details: "The phone number on the page is out of date.",
  name: "Jamie Cook",
  email: "jamie@example.com",
};

test("parseListing requires a known request type, details, a name, and an email", () => {
  assert.equal(parseListing({}).error, "Choose update, edit, deletion, new listing, or other.");
  assert.equal(parseListing({ restaurant: "Cafe" }).error, "Choose update, edit, deletion, new listing, or other.");
  assert.equal(parseListing({ restaurant: "Cafe", type: "closed" }).error, "Choose update, edit, deletion, new listing, or other.");
  assert.equal(parseListing({ restaurant: "Cafe", type: "edit" }).error, "Tell us what should change.");
  assert.equal(parseListing({ restaurant: "Cafe", type: "edit", details: "Hours" }).error, "Enter your name.");
  assert.equal(parseListing({ restaurant: "Cafe", type: "new", details: "Add it", name: "Jamie", email: "nope" }).error, "Enter a valid email.");
  assert.equal(parseListing({ ...note, restaurant: "x".repeat(161) }).error, "Keep the restaurant name under 160 characters.");
  assert.equal(parseListing({ ...note, details: "x".repeat(4001) }).error, "Keep the details under 4,000 characters.");
  assert.deepEqual(parseListing(note).value, { ...note, town: "" });
  assert.deepEqual(parseListing({ ...note, restaurant: "" }).value, { ...note, restaurant: "", town: "" });
  assert.deepEqual(parseListing({ ...note, restaurant: "   " }).value, { ...note, restaurant: "", town: "" });
  assert.deepEqual(parseListing({ ...note, town: "" }).value, { ...note, town: "" });
  assert.deepEqual(parseListing({ ...note, town: "Seaside" }).value, { ...note, town: "Seaside" });
  assert.deepEqual(parseListing({ ...note, type: "other", restaurant: "" }).value, {
    ...note,
    type: "other",
    restaurant: "",
    town: "",
  });
});

test("a blank restaurant is labeled Not specified in the listing email", async () => {
  let init = null;
  const result = await deliverListing(
    { ...note, restaurant: "", type: "other" },
    {
      RESEND_API_KEY: "re_test",
      CONTACT_EMAIL: "marc@example.com",
      SUBSCRIBE_FROM: "Eating on 30A <listings@example.com>",
    },
    (_nextUrl, nextInit) => {
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(result.ok, true);
  const body = JSON.parse(init.body);
  assert.equal(body.subject, "Eating on 30A listing: Other — Not specified");
  assert.match(body.text, /Request: Other/);
  assert.match(body.text, /Restaurant: Not specified/);
});

test("missing secrets accept the listing note and do not call Resend", async () => {
  let called = false;
  const result = await deliverListing(note, { RESEND_API_KEY: "key-only" }, () => {
    called = true;
    return Promise.resolve(new Response(""));
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false });
});

test("all three secrets post the listing note to CONTACT_EMAIL", async () => {
  let url = "";
  let init = null;
  const result = await deliverListing(
    { ...note, type: "deletion", town: "" },
    {
      RESEND_API_KEY: "re_test",
      CONTACT_EMAIL: "marc@example.com",
      SUBSCRIBE_FROM: "Eating on 30A <listings@example.com>",
    },
    (nextUrl, nextInit) => {
      url = nextUrl;
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.delivered, true);
  assert.equal(url, "https://api.resend.com/emails");
  const body = JSON.parse(init.body);
  assert.equal(body.from, "Eating on 30A <listings@example.com>");
  assert.deepEqual(body.to, ["marc@example.com"]);
  assert.equal(body.reply_to, "jamie@example.com");
  assert.match(body.subject, /Deletion/);
  assert.match(body.subject, /Bud & Alley's/);
  assert.match(body.text, /Restaurant: Bud & Alley's/);
  assert.match(body.text, /Town: Not specified/);
  assert.match(body.text, /Jamie Cook/);
  assert.match(body.text, /phone number/);
});

test("a Resend error on a listing note is not reported as delivered", async () => {
  const result = await deliverListing(
    note,
    { RESEND_API_KEY: "re_test", CONTACT_EMAIL: "marc@example.com", SUBSCRIBE_FROM: "from@example.com" },
    () => Promise.resolve(new Response("no", { status: 422 })),
  );
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.error, "The request could not be sent.");
});

test("POST JSON without secrets returns delivered false", async () => {
  const request = new Request("https://eatingon30a.example/api/listing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note),
  });
  const response = await handleListing(request, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false });
});

test("a non-POST listing request is rejected", async () => {
  const request = new Request("https://eatingon30a.example/api/listing");
  const response = await handleListing(request, {});
  assert.equal(response.status, 405);
});

test("a listing form post returns an HTML thanks page", async () => {
  const request = new Request("https://eatingon30a.example/api/listing", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(note),
  });
  const response = await handleListing(request, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your note\./);
});

test("the worker routes /api/listing without touching static assets", async () => {
  let assets = false;
  const request = new Request("https://eatingon30a.example/api/listing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note),
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
