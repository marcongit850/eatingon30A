import assert from "node:assert/strict";
import test from "node:test";
import { deliverSubscribe, handleSubscribe, parseSubscribe } from "../worker.js";

const signup = { email: "guest@example.com", audience: "local", coupons: true };

test("parseSubscribe rejects a bad email and an unknown audience", () => {
  assert.equal(parseSubscribe({ email: "nope" }).error, "Enter a valid email.");
  assert.equal(parseSubscribe({ email: "guest@example.com", audience: "other" }).error, "Choose Local or Visitor.");
  assert.deepEqual(parseSubscribe(signup).value, signup);
});

const resendEnv = {
  RESEND_API_KEY: "re_test",
  CONTACT_EMAIL: "marc@example.com",
  SUBSCRIBE_FROM: "Eating on 30A <coupons@example.com>",
};
const sheetsEnv = {
  GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test-webhook/exec",
  GOOGLE_SHEETS_WEBHOOK_TOKEN: "sheets-token",
};
const SOURCE_PAGE = "https://www.eatingon30a.com/";

function callsFor(handler) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init, calls.length - 1));
  };
  return { calls, fetchImpl };
}

function sheetJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("missing secrets accept the signup and do not call Resend or Sheets", async () => {
  let called = false;
  const result = await deliverSubscribe(signup, { RESEND_API_KEY: "key-only" }, () => {
    called = true;
    return Promise.resolve(new Response(""));
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
});

test("all three Resend secrets post the signup and skip Sheets when those secrets are missing", async () => {
  const { calls, fetchImpl } = callsFor(() => new Response("{}", { status: 200 }));
  const result = await deliverSubscribe(
    { email: "guest@example.com", audience: "visitor", coupons: false },
    resendEnv,
    fetchImpl,
  );
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.from, "Eating on 30A <coupons@example.com>");
  assert.deepEqual(body.to, ["marc@example.com"]);
  assert.match(body.text, /guest@example.com/);
  assert.match(body.text, /Visitor/);
  assert.match(body.text, /Coupons: no/);
});

test("Resend and Sheets are posted independently", async () => {
  const { calls, fetchImpl } = callsFor((url) => {
    if (url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL) return sheetJson({ ok: true });
    return new Response("{}", { status: 200 });
  });
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
  assert.equal(calls.length, 2);
  const resend = calls.find((call) => call.url === "https://api.resend.com/emails");
  const sheets = calls.find((call) => call.url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL);
  assert.ok(resend);
  assert.equal(resend.init.method, "POST");
  assert.equal(sheets.init.method, "POST");
  assert.equal(sheets.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(sheets.init.body), {
    token: "sheets-token",
    site: "30A",
    email: "guest@example.com",
    audience: "local",
    coupons: true,
    sourcePage: SOURCE_PAGE,
  });
});

test("a blank audience is omitted from the Sheets row", async () => {
  const { calls, fetchImpl } = callsFor(() => sheetJson({ ok: true }));
  const result = await deliverSubscribe(
    { email: "guest@example.com", audience: "", coupons: false },
    sheetsEnv,
    fetchImpl,
  );
  assert.deepEqual(result, { ok: true, delivered: false, recorded: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(Object.hasOwn(body, "audience"), false);
  assert.equal(body.coupons, false);
  assert.equal(body.site, "30A");
  assert.equal(body.sourcePage, SOURCE_PAGE);
});

test("one Sheets secret is not enough to call the webhook", async () => {
  let called = false;
  const result = await deliverSubscribe(signup, { GOOGLE_SHEETS_WEBHOOK_URL: sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL }, () => {
    called = true;
    return Promise.resolve(new Response("{}"));
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
});

test("a Resend error is not reported as delivered", async () => {
  const result = await deliverSubscribe(signup, resendEnv, () => Promise.resolve(new Response("no", { status: 422 })));
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.recorded, false);
  assert.equal(result.error, "The signup could not be sent.");
});

test("a Sheets outage still counts as delivered when Resend succeeded", async () => {
  const { calls, fetchImpl } = callsFor((url) => {
    if (url === "https://api.resend.com/emails") return new Response("{}", { status: 200 });
    return new Response("no", { status: 500 });
  });
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
  assert.equal(calls.length, 2);
});

test("an Apps Script HTML 200 is not recorded", async () => {
  const fetchImpl = (url) => {
    if (url === "https://api.resend.com/emails") return Promise.resolve(new Response("{}", { status: 200 }));
    return Promise.resolve(
      new Response("Script function not found: doPost", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
  };
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
});

test("a non-JSON Sheets body is not recorded", async () => {
  const fetchImpl = (url) => {
    if (url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL) {
      return Promise.resolve(new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
});

test("Sheets JSON without ok true is not recorded", async () => {
  const fetchImpl = (url) => {
    if (url === "https://api.resend.com/emails") return Promise.resolve(new Response("{}", { status: 200 }));
    return Promise.resolve(sheetJson({ ok: false }));
  };
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
});

test("an empty JSON object from Sheets is not recorded", async () => {
  const fetchImpl = (url) => {
    if (url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL) return Promise.resolve(sheetJson({}));
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
});

test("a Sheets network error still counts as delivered when Resend succeeded", async () => {
  const fetchImpl = (url) => {
    if (url === "https://api.resend.com/emails") return Promise.resolve(new Response("{}", { status: 200 }));
    return Promise.reject(new Error("webhook down"));
  };
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
});

test("a Resend failure stays failed even when Sheets recorded the row", async () => {
  const fetchImpl = (url) => {
    if (url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL) return Promise.resolve(sheetJson({ ok: true }));
    return Promise.resolve(new Response("no", { status: 422 }));
  };
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.recorded, true);
});

test("POST JSON without secrets returns delivered false and recorded false", async () => {
  const request = new Request("https://eatingon30a.example/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signup),
  });
  const response = await handleSubscribe(request, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false, recorded: false });
});

test("POST JSON reports delivered and recorded separately", async () => {
  const { calls, fetchImpl } = callsFor((url) => {
    if (url === "https://api.resend.com/emails") return new Response("{}", { status: 200 });
    return new Response("no", { status: 502 });
  });
  const request = new Request("https://eatingon30a.example/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signup),
  });
  const response = await handleSubscribe(request, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: true, recorded: false });
  assert.equal(calls.length, 2);
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

test("a form post still thanks the visitor when Sheets is down and Resend succeeded", async () => {
  let sheetBody = null;
  const fetchImpl = (url, init) => {
    if (url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL) {
      sheetBody = JSON.parse(init.body);
      return Promise.reject(new Error("webhook down"));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  const request = new Request("https://eatingon30a.example/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "guest@example.com", audience: "visitor", coupons: "yes" }),
  });
  const response = await handleSubscribe(request, { ...resendEnv, ...sheetsEnv }, fetchImpl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Thanks\. We have your signup\./);
  assert.equal(sheetBody.audience, "visitor");
  assert.equal(sheetBody.coupons, true);
  assert.equal(sheetBody.site, "30A");
});
