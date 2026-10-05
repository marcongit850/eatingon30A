import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleAccount } from "../account-api.js";
import { SCHEMA_SQL } from "../accounts/schema.js";
import { handleAccounts, resetLimits } from "../accounts/worker.js";
import worker from "../worker.js";

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

function accountsEnv(db, extra = {}) {
  return {
    DB: db,
    ACCOUNTS_SHARED_SECRET: "test-secret",
    ACCOUNTS_PUBLIC_ORIGIN: "http://127.0.0.1:8787",
    MAGIC_LINK_PREVIEW: "1",
    ...extra,
  };
}

function siteEnv(db, site) {
  const shared = accountsEnv(db);
  return {
    ACCOUNT_SITE: site,
    ACCOUNTS_SHARED_SECRET: "test-secret",
    ACCOUNTS_ORIGIN: "http://127.0.0.1:8787",
    ACCOUNTS: {
      fetch(request) {
        return handleAccounts(request, shared);
      },
    },
  };
}

function cookieValue(header, name) {
  const pair = String(header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  assert.ok(pair, `missing ${name}`);
  return pair.slice(name.length + 1);
}

test("migration SQL matches the worker schema", () => {
  const file = readFileSync(new URL("../accounts/migrations/0001_init.sql", import.meta.url), "utf8").trim();
  assert.equal(file, SCHEMA_SQL);
});

test("sign-in coupon checkboxes are off unless the visitor checks them", () => {
  const html = readFileSync(new URL("../account/index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../account.js", import.meta.url), "utf8");
  for (const name of ["coupons30a", "couponsDestin"]) {
    const input = html.match(new RegExp(`<input name="${name}"[^>]*>`));
    assert.ok(input, `${name} checkbox should be on the sign-in page`);
    assert.equal(input[0].includes("checked"), false);
    assert.match(input[0], /type="checkbox"/);
    assert.match(input[0], /value="yes"/);
  }
  assert.equal(html.includes('name="marketing"'), false);
  assert.match(html, /Email me coupons and updates from Eating on 30A\./);
  assert.match(html, /Email me coupons and updates from Eating in Destin\./);
  assert.match(html, /Leave both unchecked if you only want the sign-in link\./);
  assert.equal(html.includes("—"), false);
  assert.equal(html.includes("–"), false);
  assert.match(html, /fbq\('init', '2157446775153374'\)/);
  assert.match(html, /gtag\('config', 'G-3T7VN1WPX5'\)/);
  assert.match(script, /coupons30a: coupons30a/);
  assert.match(script, /couponsDestin: couponsDestin/);
  assert.match(script, /marketingOptIn: coupons30a \|\| couponsDestin/);
});

test("my places page names both guides", () => {
  const html = readFileSync(new URL("../my-places/index.html", import.meta.url), "utf8");
  assert.match(html, /data-tab="favorite"/);
  assert.match(html, /data-tab="want"/);
  assert.match(html, /data-site-filter="30a"/);
  assert.match(html, /data-site-filter="destin"/);
  assert.match(html, /Each card is labeled 30A or Destin/);
  assert.equal(html.includes("—"), false);
});

test("shared magic link, cookies, and labeled saves", async () => {
  resetLimits();
  const db = memoryDb();
  const accounts = accountsEnv(db);
  const site30 = siteEnv(db, "30a");
  const siteDestin = siteEnv(db, "destin");

  async function post(env, origin, path, body, cookie) {
    return handleAccount(new Request(`${origin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }), env);
  }

  let response = await post(site30, "http://127.0.0.1:8788", "/api/account/request", {
    email: "guest@example.com",
    next: "/my-places/",
  });
  let payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.delivered, false);
  assert.match(payload.previewUrl, /^http:\/\/127\.0\.0\.1:8787\/v1\/verify\?/);
  let row = await db.prepare("SELECT marketing_opt_in, created_site FROM users WHERE email = ?").bind("guest@example.com").first();
  assert.equal(row.marketing_opt_in, 0);
  assert.equal(row.created_site, "30a");

  response = await post(site30, "http://127.0.0.1:8788", "/api/account/request", {
    email: "guest@example.com",
    marketingOptIn: true,
    next: "/restaurants/bud-and-alleys-seaside/",
  });
  payload = await response.json();
  assert.equal(response.status, 200);
  row = await db.prepare("SELECT marketing_opt_in FROM users WHERE email = ?").bind("guest@example.com").first();
  assert.equal(row.marketing_opt_in, 1);

  response = await post(site30, "http://127.0.0.1:8788", "/api/account/request", {
    email: "guest@example.com",
    marketingOptIn: false,
    next: "/my-places/",
  });
  assert.equal(response.status, 200);
  row = await db.prepare("SELECT marketing_opt_in FROM users WHERE email = ?").bind("guest@example.com").first();
  assert.equal(Number(row.marketing_opt_in), 1);

  const verify = await handleAccounts(new Request(payload.previewUrl), accounts);
  assert.equal(verify.status, 302);
  const central = verify.headers.get("set-cookie");
  assert.match(central, /^ea_central=/);
  assert.equal(central.includes("Domain="), false);
  assert.match(central, /HttpOnly/);
  assert.match(central, /SameSite=Lax/);
  const finishUrl = verify.headers.get("location");
  assert.match(finishUrl, /^http:\/\/127\.0\.0\.1:8788\/api\/account\/finish\?/);
  assert.match(finishUrl, /code=/);

  const again = await handleAccounts(new Request(payload.previewUrl), accounts);
  assert.equal(again.status, 400);

  const finish = await handleAccount(new Request(finishUrl), site30);
  assert.equal(finish.status, 302);
  assert.equal(new URL(finish.headers.get("location")).pathname, "/restaurants/bud-and-alleys-seaside/");
  const session = finish.headers.get("set-cookie");
  assert.match(session, /^ea_session=/);
  assert.equal(session.includes("Domain="), false);
  assert.equal(session.includes("Secure"), false);
  const token = cookieValue(session, "ea_session");

  const reused = await handleAccount(new Request(finishUrl), site30);
  assert.equal(reused.status, 302);
  assert.match(reused.headers.get("location"), /need=1/);
  assert.equal(reused.headers.get("set-cookie"), null);

  const secureFinish = await handleAccount(new Request(finishUrl.replace("http://127.0.0.1:8788", "https://www.eatingon30a.com")), site30);
  assert.equal(secureFinish.status, 302);
  assert.match(secureFinish.headers.get("location"), /need=1/);

  response = await handleAccount(new Request("http://127.0.0.1:8788/api/account/saves", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: `ea_session=${token}` },
    body: JSON.stringify({
      slug: "bud-and-alleys-seaside",
      name: "Bud & Alley's",
      area: "Seaside",
      kind: "favorite",
      saved: true,
    }),
  }), site30);
  assert.equal(response.status, 200);

  response = await handleAccount(new Request("http://127.0.0.1:8788/api/account/saves", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: `ea_session=${token}` },
    body: JSON.stringify({
      slug: "harbor-docks-destin-harbor",
      name: "Harbor Docks",
      area: "Destin Harbor",
      kind: "want",
      site: "destin",
      saved: true,
    }),
  }), site30);
  assert.equal(response.status, 400);

  const cont = await handleAccounts(new Request(
    `http://127.0.0.1:8787/v1/continue?site=destin&return=${encodeURIComponent("http://127.0.0.1:8789/api/account/finish?next=/my-places/")}`,
    { headers: { cookie: `ea_central=${cookieValue(central, "ea_central")}` } },
  ), accounts);
  assert.equal(cont.status, 302);
  assert.match(cont.headers.get("location"), /^http:\/\/127\.0\.0\.1:8789\/api\/account\/finish\?/);
  const destinFinish = await handleAccount(new Request(cont.headers.get("location")), siteDestin);
  const destinToken = cookieValue(destinFinish.headers.get("set-cookie"), "ea_session");

  response = await handleAccount(new Request("http://127.0.0.1:8789/api/account/saves", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: `ea_session=${destinToken}` },
    body: JSON.stringify({
      slug: "harbor-docks-destin-harbor",
      name: "Harbor Docks",
      area: "Destin Harbor",
      kind: "want",
      saved: true,
    }),
  }), siteDestin);
  assert.equal(response.status, 200);

  response = await handleAccount(new Request("http://127.0.0.1:8788/api/account/saves", {
    headers: { cookie: `ea_session=${token}` },
  }), site30);
  payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.saves.map((item) => [item.site, item.kind, item.slug]).sort(),
    [
      ["30a", "favorite", "bud-and-alleys-seaside"],
      ["destin", "want", "harbor-docks-destin-harbor"],
    ],
  );

  const me = await handleAccount(new Request("http://127.0.0.1:8788/api/account/me", {
    headers: { cookie: `ea_session=${token}` },
  }), site30);
  payload = await me.json();
  assert.equal(payload.user.email, "guest@example.com");
  assert.equal(payload.user.marketingOptIn, true);

  const loggedOut = await handleAccount(new Request("http://127.0.0.1:8788/api/account/logout", {
    method: "POST",
    headers: { cookie: `ea_session=${token}` },
  }), site30);
  assert.match(loggedOut.headers.get("set-cookie"), /ea_session=;/);
  const after = await handleAccount(new Request("http://127.0.0.1:8788/api/account/me", {
    headers: { cookie: `ea_session=${token}` },
  }), site30);
  assert.deepEqual(await after.json(), { ok: true, user: null });
  const destinAfter = await handleAccount(new Request("http://127.0.0.1:8789/api/account/me", {
    headers: { cookie: `ea_session=${destinToken}` },
  }), siteDestin);
  assert.deepEqual(await destinAfter.json(), { ok: true, user: null });

  const cold = await handleAccounts(new Request(
    `http://127.0.0.1:8787/v1/continue?site=destin&return=${encodeURIComponent("http://127.0.0.1:8789/api/account/finish?next=/my-places/")}`,
    { headers: { cookie: `ea_central=${cookieValue(central, "ea_central")}` } },
  ), accounts);
  assert.match(cold.headers.get("location"), /need=1/);
});

test("magic links stay private unless preview is explicitly on", async () => {
  resetLimits();
  const db = memoryDb();
  const env = accountsEnv(db, { MAGIC_LINK_PREVIEW: "", RESEND_API_KEY: "", SUBSCRIBE_FROM: "" });
  const response = await handleAccounts(new Request("https://eating-accounts.352marc.workers.dev/v1/magic-link", {
    method: "POST",
    headers: {
      authorization: "Bearer test-secret",
      "content-type": "application/json",
      "x-account-site": "30a",
    },
    body: JSON.stringify({
      email: "quiet@example.com",
      marketingOptIn: false,
      site: "30a",
      returnTo: "https://www.eatingon30a.com/api/account/finish?next=/my-places/",
    }),
  }), env);
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.previewUrl, undefined);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM users").bind().first().then((row) => row.n), 0);
});

test("a foreign return address is rejected", async () => {
  resetLimits();
  const response = await handleAccount(new Request("http://127.0.0.1:8788/api/account/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "guest@example.com", next: "https://evil.example/steal" }),
  }), siteEnv(memoryDb(), "30a"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "That return address is not allowed.");
});

test("missing account secret does not pretend the email was sent", async () => {
  const response = await handleAccount(new Request("https://www.eatingon30a.com/api/account/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "guest@example.com" }),
  }), { ACCOUNT_SITE: "30a", ACCOUNTS_ORIGIN: "https://eating-accounts.352marc.workers.dev" });
  assert.equal(response.status, 503);
});

const SHEETS_URL = "https://script.google.com/macros/s/test-webhook/exec";
const ACCOUNT_SOURCE = "https://www.eatingon30a.com/account/";

function sheetEnv(db, extra = {}) {
  return {
    ...siteEnv(db, "30a"),
    GOOGLE_SHEETS_WEBHOOK_URL: SHEETS_URL,
    GOOGLE_SHEETS_WEBHOOK_TOKEN: "token-30a",
    GOOGLE_SHEETS_WEBHOOK_TOKEN_DESTIN: "token-destin",
    RESEND_API_KEY: "re_test",
    CONTACT_EMAIL: "marc@example.com",
    SUBSCRIBE_FROM: "Eating on 30A <coupons@example.com>",
    ...extra,
  };
}

function captureFetch() {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  };
  return { calls, fetchImpl };
}

async function requestSignIn(env, body, fetchImpl, headers = { "content-type": "application/json" }) {
  const payload = headers["content-type"].includes("json") ? JSON.stringify(body) : body;
  return handleAccount(new Request("https://www.eatingon30a.com/api/account/request", {
    method: "POST",
    headers,
    body: payload,
  }), env, fetchImpl);
}

function sheetRows(calls) {
  return calls
    .filter((call) => call.url === SHEETS_URL)
    .map((call) => JSON.parse(call.init.body));
}

test("checked coupon boxes append one sheet row per site and skip the coupon email", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = captureFetch();
  const response = await requestSignIn(sheetEnv(db), {
    email: "both@example.com",
    coupons30a: true,
    couponsDestin: true,
    marketingOptIn: true,
    next: "/my-places/",
  }, fetchImpl);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.match(payload.previewUrl, /\/v1\/verify\?/);
  assert.equal(calls.some((call) => call.url === "https://api.resend.com/emails"), false);
  const rows = sheetRows(calls);
  assert.equal(rows.length, 2);
  const row30 = rows.find((row) => row.site === "30A");
  const rowDestin = rows.find((row) => row.site === "Destin");
  assert.deepEqual(row30, {
    token: "token-30a",
    site: "30A",
    email: "both@example.com",
    coupons: true,
    sourcePage: ACCOUNT_SOURCE,
  });
  assert.deepEqual(rowDestin, {
    token: "token-destin",
    site: "Destin",
    email: "both@example.com",
    coupons: true,
    sourcePage: ACCOUNT_SOURCE,
  });
  assert.equal(Object.hasOwn(row30, "audience"), false);
  assert.equal(Object.hasOwn(rowDestin, "audience"), false);
  const user = await db.prepare("SELECT marketing_opt_in FROM users WHERE email = ?").bind("both@example.com").first();
  assert.equal(user.marketing_opt_in, 1);
});

test("one checked coupon box appends only that sheet row", async () => {
  resetLimits();
  const db = memoryDb();
  const destinOnly = captureFetch();
  let response = await requestSignIn(sheetEnv(db), {
    email: "destin-only@example.com",
    coupons30a: false,
    couponsDestin: true,
    next: "/my-places/",
  }, destinOnly.fetchImpl);
  assert.equal(response.status, 200);
  assert.deepEqual(sheetRows(destinOnly.calls).map((row) => row.site), ["Destin"]);

  const thirtyOnly = captureFetch();
  response = await requestSignIn(sheetEnv(db), {
    email: "thirty-only@example.com",
    coupons30a: true,
    couponsDestin: false,
    next: "/my-places/",
  }, thirtyOnly.fetchImpl);
  assert.equal(response.status, 200);
  assert.deepEqual(sheetRows(thirtyOnly.calls).map((row) => [row.site, row.token]), [["30A", "token-30a"]]);
  const user = await db.prepare("SELECT marketing_opt_in FROM users WHERE email = ?").bind("destin-only@example.com").first();
  assert.equal(user.marketing_opt_in, 1);
});

test("a missing Destin token skips that row and still sends the magic link", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = captureFetch();
  const response = await requestSignIn(sheetEnv(db, { GOOGLE_SHEETS_WEBHOOK_TOKEN_DESTIN: "" }), {
    email: "no-destin-token@example.com",
    coupons30a: true,
    couponsDestin: true,
    marketingOptIn: true,
    next: "/my-places/",
  }, fetchImpl);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(sheetRows(calls).map((row) => row.site), ["30A"]);
  const user = await db.prepare("SELECT marketing_opt_in FROM users WHERE email = ?").bind("no-destin-token@example.com").first();
  assert.equal(user.marketing_opt_in, 1);
});

test("unchecked coupon boxes do not call the sheet webhook", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = captureFetch();
  const response = await requestSignIn(sheetEnv(db), {
    email: "quiet-sheets@example.com",
    coupons30a: false,
    couponsDestin: false,
    marketingOptIn: false,
    next: "/my-places/",
  }, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 0);
  const user = await db.prepare("SELECT marketing_opt_in FROM users WHERE email = ?").bind("quiet-sheets@example.com").first();
  assert.equal(user.marketing_opt_in, 0);
});

test("a sheet failure does not fail an accepted magic link", async () => {
  resetLimits();
  const db = memoryDb();
  const response = await requestSignIn(sheetEnv(db), {
    email: "sheet-down@example.com",
    coupons30a: true,
    couponsDestin: true,
    next: "/my-places/",
  }, () => Promise.reject(new Error("sheet down")));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.match(payload.previewUrl, /\/v1\/verify\?/);
});

test("a rejected magic link does not write the coupon sheet", async () => {
  const calls = [];
  const env = sheetEnv(memoryDb(), {
    ACCOUNTS: {
      fetch() {
        return new Response(JSON.stringify({ ok: false, error: "Please wait a while and try again." }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  const response = await requestSignIn(env, {
    email: "limited@example.com",
    coupons30a: true,
    couponsDestin: true,
    next: "/my-places/",
  }, (url) => {
    calls.push(url);
    return Promise.resolve(new Response("{}"));
  });
  assert.equal(response.status, 429);
  assert.equal(calls.length, 0);
});

test("a form post with a coupon checkbox appends that sheet row", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = captureFetch();
  const response = await requestSignIn(
    sheetEnv(db),
    new URLSearchParams({ email: "form@example.com", couponsDestin: "yes", next: "/my-places/" }),
    fetchImpl,
    { "content-type": "application/x-www-form-urlencoded" },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(sheetRows(calls), [{
    token: "token-destin",
    site: "Destin",
    email: "form@example.com",
    coupons: true,
    sourcePage: ACCOUNT_SOURCE,
  }]);
  const user = await db.prepare("SELECT marketing_opt_in FROM users WHERE email = ?").bind("form@example.com").first();
  assert.equal(user.marketing_opt_in, 1);
});

test("the site worker answers account config without touching assets", async () => {
  const response = await worker.fetch(new Request("https://www.eatingon30a.com/api/account/config"), {
    ACCOUNT_SITE: "30a",
    ACCOUNTS_ORIGIN: "https://eating-accounts.352marc.workers.dev",
    ASSETS: { fetch() { throw new Error("assets should not be called"); } },
  });
  assert.deepEqual(await response.json(), {
    ok: true,
    site: "30a",
    accountsOrigin: "https://eating-accounts.352marc.workers.dev",
  });
});
