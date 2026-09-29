import assert from "node:assert/strict";
import test from "node:test";
import { deliverSubscribe, handleSubscribe, parseSubscribe } from "../worker.js";

const signup = { email: "guest@example.com", audience: "local", coupons: true };

test("parseSubscribe rejects a bad email and an unknown audience", () => {
  assert.equal(parseSubscribe({ email: "nope" }).error, "Enter a valid email.");
  assert.equal(parseSubscribe({ email: "guest@example.com", audience: "other" }).error, "Choose Local or Visitor.");
  assert.deepEqual(parseSubscribe(signup).value, signup);
});

test("missing secrets accept the signup and do not call Resend", async () => {
  let called = false;
  const result = await deliverSubscribe(signup, { RESEND_API_KEY: "key-only" }, () => {
    called = true;
    return Promise.resolve(new Response(""));
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false });
});

test("all three secrets post the signup to Resend", async () => {
  let url = "";
  let init = null;
  const result = await deliverSubscribe(
    { email: "guest@example.com", audience: "visitor", coupons: false },
    {
      RESEND_API_KEY: "re_test",
      CONTACT_EMAIL: "marc@example.com",
      SUBSCRIBE_FROM: "Eating on 30A <coupons@example.com>",
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
  assert.equal(body.from, "Eating on 30A <coupons@example.com>");
  assert.deepEqual(body.to, ["marc@example.com"]);
  assert.match(body.text, /guest@example.com/);
  assert.match(body.text, /Visitor/);
  assert.match(body.text, /Coupons: no/);
});

test("a Resend error is not reported as delivered", async () => {
  const result = await deliverSubscribe(
    signup,
    { RESEND_API_KEY: "re_test", CONTACT_EMAIL: "marc@example.com", SUBSCRIBE_FROM: "from@example.com" },
    () => Promise.resolve(new Response("no", { status: 422 })),
  );
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
});

test("POST JSON without secrets returns delivered false", async () => {
  const request = new Request("https://eatingon30a.example/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signup),
  });
  const response = await handleSubscribe(request, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false });
});

test("a non-POST is rejected", async () => {
  const request = new Request("https://eatingon30a.example/api/subscribe");
  const response = await handleSubscribe(request, {});
  assert.equal(response.status, 405);
});

test("a form post returns an HTML thanks page", async () => {
  const request = new Request("https://eatingon30a.example/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "guest@example.com", audience: "local", coupons: "yes" }),
  });
  const response = await handleSubscribe(request, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your signup\./);
});
