import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
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
const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_LIST_URL = "https://campaigns.zoho.com/api/v1.1/json/listsubscribe";
const zohoEnv = {
  ZOHO_CLIENT_ID: "zoho-client",
  ZOHO_CLIENT_SECRET: "zoho-secret",
  ZOHO_REFRESH_TOKEN: "zoho-refresh",
  ZOHO_LIST_KEY_30A: "list-30a",
  ZOHO_LIST_KEY_DESTIN: "list-destin",
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
  assert.equal(calls.some((call) => String(call.url).includes("zoho.com")), false);
});

function zohoRoutes(url, listStatus = 200) {
  if (url === ZOHO_TOKEN_URL) {
    return new Response(JSON.stringify({ access_token: "zoho-access", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === ZOHO_LIST_URL) {
    return new Response(JSON.stringify({ status: listStatus === 200 ? "success" : "error" }), {
      status: listStatus,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === "https://api.resend.com/emails") return new Response("{}", { status: 200 });
  if (url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL) return sheetJson({ ok: true });
  return new Response("no", { status: 500 });
}

test("Resend, Sheets, and Zoho 30A are posted independently", async () => {
  const { calls, fetchImpl } = callsFor((url) => zohoRoutes(url));
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv, ...zohoEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
  const resend = calls.find((call) => call.url === "https://api.resend.com/emails");
  const sheets = calls.find((call) => call.url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL);
  const token = calls.find((call) => call.url === ZOHO_TOKEN_URL);
  const lists = calls.filter((call) => call.url === ZOHO_LIST_URL);
  assert.ok(resend);
  assert.equal(sheets.init.method, "POST");
  assert.deepEqual(JSON.parse(sheets.init.body), {
    token: "sheets-token",
    site: "30A",
    email: "guest@example.com",
    audience: "local",
    coupons: true,
    sourcePage: SOURCE_PAGE,
  });
  assert.equal(lists.length, 1);
  assert.equal(token.init.method, "POST");
  assert.equal(token.init.headers["content-type"], "application/x-www-form-urlencoded");
  const tokenBody = new URLSearchParams(token.init.body);
  assert.equal(tokenBody.get("grant_type"), "refresh_token");
  assert.equal(tokenBody.get("client_id"), "zoho-client");
  assert.equal(tokenBody.get("client_secret"), "zoho-secret");
  assert.equal(tokenBody.get("refresh_token"), "zoho-refresh");
  assert.equal(lists[0].init.method, "POST");
  assert.equal(lists[0].init.headers.authorization, "Zoho-oauthtoken zoho-access");
  assert.equal(lists[0].init.headers["content-type"], "application/x-www-form-urlencoded");
  const listBody = new URLSearchParams(lists[0].init.body);
  assert.equal(listBody.get("resfmt"), "JSON");
  assert.equal(listBody.get("listkey"), "list-30a");
  assert.equal(listBody.get("source"), "eatingon30a-subscribe");
  assert.deepEqual(JSON.parse(listBody.get("contactinfo")), { "Contact Email": "guest@example.com" });
});

test("Zoho still subscribes when Sheets secrets are missing", async () => {
  const { calls, fetchImpl } = callsFor((url) => zohoRoutes(url));
  const result = await deliverSubscribe(signup, { ...resendEnv, ...zohoEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
  assert.equal(calls.some((call) => call.url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL), false);
  assert.equal(calls.filter((call) => call.url === ZOHO_LIST_URL).length, 1);
  assert.equal(new URLSearchParams(calls.find((call) => call.url === ZOHO_LIST_URL).init.body).get("listkey"), "list-30a");
});

test("guest signup ignores the Destin list key", async () => {
  const { calls, fetchImpl } = callsFor((url) => zohoRoutes(url));
  const env = { ...zohoEnv, ZOHO_LIST_KEY_30A: "" };
  const result = await deliverSubscribe(signup, env, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
  assert.equal(calls.length, 0);
});

test("one Zoho secret is not enough to call listsubscribe", async () => {
  for (const env of [
    { ZOHO_CLIENT_ID: zohoEnv.ZOHO_CLIENT_ID },
    { ZOHO_LIST_KEY_30A: zohoEnv.ZOHO_LIST_KEY_30A },
    {
      ZOHO_CLIENT_ID: zohoEnv.ZOHO_CLIENT_ID,
      ZOHO_CLIENT_SECRET: zohoEnv.ZOHO_CLIENT_SECRET,
      ZOHO_REFRESH_TOKEN: zohoEnv.ZOHO_REFRESH_TOKEN,
    },
  ]) {
    let called = false;
    const result = await deliverSubscribe(signup, env, () => {
      called = true;
      return Promise.resolve(new Response("{}"));
    });
    assert.equal(called, false);
    assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
  }
});

test("a Zoho outage still counts as delivered and recorded when Resend and Sheets succeeded", async () => {
  const { calls, fetchImpl } = callsFor((url) => {
    if (url === ZOHO_TOKEN_URL) return new Response("no", { status: 500 });
    return zohoRoutes(url);
  });
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv, ...zohoEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
  assert.equal(calls.some((call) => call.url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL), true);
  assert.equal(calls.some((call) => call.url === "https://api.resend.com/emails"), true);
  assert.equal(calls.some((call) => call.url === ZOHO_LIST_URL), false);
});

test("a Zoho list error does not change delivered or recorded", async () => {
  const { calls, fetchImpl } = callsFor((url) => zohoRoutes(url, 502));
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv, ...zohoEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
  assert.equal(calls.filter((call) => call.url === ZOHO_LIST_URL).length, 1);
  const sheets = calls.find((call) => call.url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL);
  assert.equal(JSON.parse(sheets.init.body).email, "guest@example.com");
});

test("a Zoho network error still counts as delivered and recorded", async () => {
  const fetchImpl = (url) => {
    if (url === ZOHO_TOKEN_URL || url === ZOHO_LIST_URL) return Promise.reject(new Error("zoho down"));
    if (url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL) return Promise.resolve(sheetJson({ ok: true }));
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv, ...zohoEnv }, fetchImpl);
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
});

test("a Resend failure stays failed when Zoho subscribed the list", async () => {
  const fetchImpl = (url) => {
    if (url === ZOHO_TOKEN_URL) return Promise.resolve(zohoRoutes(url));
    if (url === ZOHO_LIST_URL) return Promise.resolve(zohoRoutes(url));
    if (url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL) return Promise.resolve(sheetJson({ ok: true }));
    return Promise.resolve(new Response("no", { status: 422 }));
  };
  const result = await deliverSubscribe(signup, { ...resendEnv, ...sheetsEnv, ...zohoEnv }, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.recorded, true);
  assert.equal(result.error, "The signup could not be sent.");
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
  const html = await response.text();
  assert.match(html, /Thanks\. We have your signup\./);
  assert.match(html, /fbq\('init', '2157446775153374'\)/);
  assert.match(html, /fbq\('track', 'PageView'\)/);
  assert.match(html, /connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.match(html, /<body[^>]*>\s*<noscript><img height="1" width="1" style="display:none" src="https:\/\/www\.facebook\.com\/tr\?id=2157446775153374&ev=PageView&noscript=1"\/><\/noscript>/);
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

const subscribeSource = readFileSync(new URL("../subscribe.js", import.meta.url), "utf8");
const POPUP_NOW = 1_700_000_000_000;

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

function loadPopup(options = {}) {
  const fetches = [];
  const timers = [];
  const pending = [];
  const nav = {
    textContent: options.navText ?? "Sign in",
    getAttribute(name) {
      if (name === "href") return options.navHref ?? "/account/";
      return null;
    },
  };
  const dialog = {
    open: false,
    shown: 0,
    showModal() {
      this.open = true;
      this.shown += 1;
    },
    close() {
      this.open = false;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  const document = {
    getElementById(id) {
      return id === "subscribe-popup" ? dialog : null;
    },
    querySelector(selector) {
      if (selector === "[data-account-nav]") return options.nav === false ? null : nav;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const meBody = options.me === undefined ? { ok: true, user: null } : options.me;
  const configBody = options.config === undefined
    ? { ok: true, site: "30a", accountsOrigin: "https://accounts.example" }
    : options.config;
  function fetch(url, init) {
    fetches.push({ url, init });
    const hang = options.hang === true || options.hang === url;
    if (hang) {
      return new Promise((resolve, reject) => {
        pending.push({ url, resolve, reject });
      });
    }
    if (options.failMe && url === "/api/account/me") return Promise.reject(new Error("offline"));
    const body = url === "/api/account/me" ? meBody : configBody;
    return Promise.resolve({
      json() {
        return Promise.resolve(body);
      },
    });
  }
  const now = options.now ?? POPUP_NOW;
  const sandbox = {
    document,
    location: { pathname: options.path || "/" },
    fetch,
    sessionStorage: memoryStorage(options.session),
    localStorage: memoryStorage(options.local),
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    Date: { now() { return now; } },
    Promise,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(subscribeSource, sandbox, { filename: "subscribe.js" });
  return { dialog, timers, fetches, nav, pending };
}

function flush() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function openAfterDelay(popup) {
  assert.equal(popup.dialog.shown, 0);
  assert.equal(popup.timers.length, 1);
  popup.timers[0].fn();
  await flush();
}

test("a signed-in account never opens the coupon dialog", async () => {
  const popup = loadPopup({ me: { ok: true, user: { email: "guest@example.com" } } });
  assert.equal(popup.timers[0].ms, 30000);
  assert.deepEqual(popup.fetches.map((call) => call.url), ["/api/account/me", "/api/account/config"]);
  for (const call of popup.fetches) assert.equal(call.init.credentials, "same-origin");
  await openAfterDelay(popup);
  assert.equal(popup.dialog.shown, 0);
  assert.equal(popup.dialog.open, false);
});

test("My places in the account nav blocks the coupon dialog", async () => {
  const ready = loadPopup({ navText: " My places ", me: { ok: true, user: null } });
  assert.equal(ready.timers.length, 0);
  assert.equal(ready.fetches.length, 0);
  assert.equal(ready.dialog.shown, 0);

  const later = loadPopup({ me: { ok: true, user: null } });
  later.nav.textContent = "My places";
  await openAfterDelay(later);
  assert.equal(later.dialog.shown, 0);
});

test("a signed-out visitor still gets the coupon dialog after the delay", async () => {
  const popup = loadPopup({
    me: { ok: true, user: null },
    session: { "eo30a-visit-start": String(POPUP_NOW - 12000) },
  });
  assert.equal(popup.dialog.shown, 0);
  assert.equal(popup.timers[0].ms, 18000);
  popup.timers[0].fn();
  await flush();
  assert.equal(popup.dialog.shown, 1);
  assert.equal(popup.dialog.open, true);
});

test("a late account response still decides the coupon dialog", async () => {
  const signedIn = loadPopup({ hang: "/api/account/me", me: { ok: true, user: { email: "guest@example.com" } } });
  signedIn.timers[0].fn();
  await flush();
  assert.equal(signedIn.dialog.shown, 0);
  signedIn.pending[0].resolve({
    json() {
      return Promise.resolve({ ok: true, user: { email: "guest@example.com" } });
    },
  });
  await flush();
  assert.equal(signedIn.dialog.shown, 0);

  const signedOut = loadPopup({ hang: true });
  assert.equal(signedOut.dialog.shown, 0);
  signedOut.timers[0].fn();
  await flush();
  assert.equal(signedOut.dialog.shown, 0);
  for (const entry of signedOut.pending) {
    const body = entry.url === "/api/account/me"
      ? { ok: true, user: null }
      : { ok: true, site: "30a", accountsOrigin: "" };
    entry.resolve({
      json() {
        return Promise.resolve(body);
      },
    });
  }
  await flush();
  assert.equal(signedOut.dialog.shown, 1);
});

test("a failed account check still shows the popup unless My places is already visible", async () => {
  const offline = loadPopup({ failMe: true });
  await openAfterDelay(offline);
  assert.equal(offline.dialog.shown, 1);

  const places = loadPopup({ failMe: true, navText: "My places" });
  assert.equal(places.timers.length, 0);
  assert.equal(places.dialog.shown, 0);
});

test("my places and a dismissed coupon stay closed without an account check", () => {
  for (const path of ["/my-places", "/my-places/"]) {
    const popup = loadPopup({ path, me: { ok: true, user: null } });
    assert.equal(popup.timers.length, 0);
    assert.equal(popup.fetches.length, 0);
    assert.equal(popup.dialog.shown, 0);
  }
  const dismissed = loadPopup({
    me: { ok: true, user: null },
    session: { "eo30a-sid": "visit-1" },
    local: { "eo30a-coupon-popup": "visit-1" },
  });
  assert.equal(dismissed.timers.length, 0);
  assert.equal(dismissed.fetches.length, 0);
  assert.equal(dismissed.dialog.shown, 0);
});

test("the delay is skipped when this visit already waited 30 seconds", async () => {
  const popup = loadPopup({
    me: { ok: true, user: { email: "guest@example.com" } },
    session: { "eo30a-visit-start": String(POPUP_NOW - 60000) },
  });
  assert.equal(popup.timers[0].ms, 0);
  await openAfterDelay(popup);
  assert.equal(popup.dialog.shown, 0);
});
