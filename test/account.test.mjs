import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleAccount } from "../account-api.js";
import { SAVE_NOTE_SQL, SCHEMA_SQL } from "../accounts/schema.js";
import { ensureSchema, handleAccounts, resetLimits } from "../accounts/worker.js";
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

test("restaurant cards save with the same sign-in and PUT behavior", () => {
  const script = readFileSync(new URL("../account.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const directory = readFileSync(new URL("../restaurants/index.html", import.meta.url), "utf8");
  const area = readFileSync(new URL("../areas/seaside/index.html", import.meta.url), "utf8");
  const nearby = readFileSync(new URL("../areas/nearby/index.html", import.meta.url), "utf8");
  const guide = readFileSync(new URL("../guides/best-seafood-30a/index.html", import.meta.url), "utf8");
  const guideIndex = readFileSync(new URL("../guides/index.html", import.meta.url), "utf8");
  for (const html of [directory, area, nearby, guide]) {
    assert.match(html, /class="card-link"/);
    assert.match(html, /class="save-slot"/);
    assert.equal(html.includes('class="card-save"'), false);
  }
  assert.equal(guideIndex.includes('class="save-slot"'), false);
  assert.match(script, /querySelectorAll\("\.save-slot"\)/);
  assert.match(script, /location\.href = signInHref\(\)/);
  assert.match(script, /method: "PUT"/);
  assert.match(script, /if \(chips\) head\.insertBefore\(bar, chips\)/);
  assert.match(styles, /\.card \.save-slot \{[^}]*align-self: end/);
  assert.match(styles, /linear-gradient\(to top, rgba\(16, 40, 37, 0\.62\)/);
  assert.equal(script.includes("—"), false);
});

test("my places page names both guides", () => {
  const html = readFileSync(new URL("../my-places/index.html", import.meta.url), "utf8");
  assert.match(html, /data-tab="favorite"/);
  assert.match(html, /data-tab="want"/);
  assert.match(html, /data-site-filter="30a"/);
  assert.match(html, /data-site-filter="destin"/);
  assert.match(html, /Each card is labeled 30A or Destin/);
  assert.match(html, /Notes stay private on your account\. Shown on My places for each saved restaurant \(Favorites and Want to try\)\./);
  assert.equal(html.includes("—"), false);
  assert.equal(html.includes("–"), false);
});

test("my places coupon opt-in is a quiet section, not a popup", () => {
  const html = readFileSync(new URL("../my-places/index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../account.js", import.meta.url), "utf8");
  const subscribe = readFileSync(new URL("../subscribe.js", import.meta.url), "utf8");
  assert.match(html, /data-coupon-optin hidden/);
  assert.match(html, /action="\/api\/account\/coupons"/);
  assert.equal(html.includes("<dialog"), false);
  assert.equal(html.includes("subscribe-popup"), false);
  assert.equal(html.includes('type="email"'), false);
  assert.equal(html.includes("—"), false);
  assert.equal(html.includes("–"), false);
  for (const name of ["coupons30a", "couponsDestin"]) {
    const input = html.match(new RegExp(`<input name="${name}"[^>]*>`));
    assert.ok(input, `${name} checkbox should be on My places`);
    assert.equal(input[0].includes("checked"), false);
    assert.match(input[0], /type="checkbox"/);
    assert.match(input[0], /value="yes"/);
  }
  assert.match(html, /Email me coupons and updates from Eating on 30A\./);
  assert.match(html, /Email me coupons and updates from Eating in Destin\./);
  assert.match(html, /This uses the email on your account\./);
  assert.match(script, /block\.hidden = false/);
  assert.match(script, /\/api\/account\/coupons/);
  assert.match(script, /JSON\.stringify\(\{\s*coupons30a: coupons30a,\s*couponsDestin: couponsDestin\s*\}\)/);
  assert.equal(script.includes("api.resend.com"), false);
  assert.equal(script.includes("—"), false);
  assert.equal(script.includes("–"), false);
  assert.match(subscribe, /path === "\/my-places" \|\| path === "\/my-places\/"/);
});

test("note migration matches the worker alter", () => {
  const file = readFileSync(new URL("../accounts/migrations/0002_save_note.sql", import.meta.url), "utf8");
  assert.equal(file.includes(SAVE_NOTE_SQL), true);
  assert.equal(file.includes("—"), false);
});

test("an existing saves table gains a note column", async () => {
  const db = memoryDb();
  const before = await db.prepare("PRAGMA table_info(saves)").all();
  assert.equal(before.results.some((column) => column.name === "note"), false);
  await ensureSchema(db);
  const after = await db.prepare("PRAGMA table_info(saves)").all();
  assert.equal(after.results.some((column) => column.name === "note"), true);
  await ensureSchema(db);
});

test("personal notes stay on the account and off public listing html", () => {
  const script = readFileSync(new URL("../account.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const page = readFileSync(new URL("../restaurants/the-donut-hole-inlet-beach/index.html", import.meta.url), "utf8");
  assert.match(script, /Add a personal note\.\.\./);
  assert.match(script, /Only you can see this\. It also shows on My places\. About 280 characters\./);
  assert.match(script, /Save note/);
  assert.equal(script.includes("Edit note"), false);
  assert.equal(script.includes("Add note"), false);
  assert.match(script, /maxlength="280"/);
  assert.match(script, /maxLength = 280/);
  assert.match(script, /editor\.value = save\.note \|\| ""/);
  assert.equal(/editor\.hidden/.test(script), false);
  const noteWrites = [];
  const marker = "putSave({";
  let index = 0;
  while ((index = script.indexOf(marker, index)) !== -1) {
    const start = index + "putSave(".length;
    let depth = 0;
    let end = start;
    for (; end < script.length; end += 1) {
      if (script[end] === "{") depth += 1;
      else if (script[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    const body = script.slice(start, end);
    if (/\bnote\s*:/.test(body)) noteWrites.push(body);
    index = end;
  }
  assert.equal(noteWrites.length, 2);
  for (const body of noteWrites) {
    assert.match(body, /saved:\s*true/);
    assert.equal(/\bsaved:\s*false/.test(body), false);
  }
  const placesNote = noteWrites.find((body) => /site:\s*save\.site/.test(body));
  assert.ok(placesNote);
  assert.match(placesNote, /note:\s*text/);
  assert.equal(script.includes("—"), false);
  assert.equal(script.includes("card-grid"), false);
  assert.match(css, /\.personal-note \{/);
  assert.match(css, /\.place-note-input \{/);
  assert.equal(page.includes("Only you can see this"), false);
  assert.equal(page.includes("personal-note"), false);
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
  assert.match(central, /Max-Age=604800/);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const centralSession = await db.prepare("SELECT expires_at FROM sessions WHERE site = 'central'").first();
  assert.ok(Math.abs(Number(centralSession.expires_at) - Date.now() - weekMs) < 60_000);
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
  assert.match(session, /Max-Age=604800/);
  const siteSession = await db.prepare("SELECT expires_at FROM sessions WHERE site = '30a'").first();
  assert.ok(Math.abs(Number(siteSession.expires_at) - Date.now() - weekMs) < 60_000);
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
const PLACES_SOURCE = "https://www.eatingon30a.com/my-places/";

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

const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_LIST_URL = "https://campaigns.zoho.com/api/v1.1/json/listsubscribe";
const zohoSecrets = {
  ZOHO_CLIENT_ID: "zoho-client",
  ZOHO_CLIENT_SECRET: "zoho-secret",
  ZOHO_REFRESH_TOKEN: "zoho-refresh",
  ZOHO_LIST_KEY_30A: "list-30a",
  ZOHO_LIST_KEY_DESTIN: "list-destin",
};

function zohoCapture(listStatus = 200) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push({ url, init });
    if (url === ZOHO_TOKEN_URL) {
      return Promise.resolve(new Response(JSON.stringify({ access_token: "zoho-access" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }
    if (url === ZOHO_LIST_URL) {
      return Promise.resolve(new Response(JSON.stringify({ status: listStatus === 200 ? "success" : "error" }), {
        status: listStatus,
        headers: { "content-type": "application/json" },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  };
  return { calls, fetchImpl };
}

function zohoLists(calls) {
  return calls
    .filter((call) => call.url === ZOHO_LIST_URL)
    .map((call) => {
      const params = new URLSearchParams(call.init.body);
      return {
        listkey: params.get("listkey"),
        source: params.get("source"),
        resfmt: params.get("resfmt"),
        contact: JSON.parse(params.get("contactinfo")),
        authorization: call.init.headers.authorization,
        method: call.init.method,
      };
    });
}

async function sessionFor(db, email) {
  const site = siteEnv(db, "30a");
  const response = await requestSignIn(site, { email, next: "/my-places/" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  const verify = await handleAccounts(new Request(payload.previewUrl), accountsEnv(db));
  assert.equal(verify.status, 302);
  const finish = await handleAccount(new Request(verify.headers.get("location")), site);
  assert.equal(finish.status, 302);
  return cookieValue(finish.headers.get("set-cookie"), "ea_session");
}

async function postCoupons(env, token, body, fetchImpl, headers = { "content-type": "application/json" }) {
  const payload = headers["content-type"].includes("json") ? JSON.stringify(body) : body;
  return handleAccount(new Request("https://www.eatingon30a.com/api/account/coupons", {
    method: "POST",
    headers: {
      ...headers,
      ...(token ? { cookie: `ea_session=${token}` } : {}),
    },
    body: payload,
  }), env, fetchImpl);
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
  assert.equal(calls.some((call) => String(call.url).includes("zoho.com")), false);
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

test("checked coupon boxes subscribe the matching Zoho lists and still write both sheet rows", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = zohoCapture();
  const response = await requestSignIn(sheetEnv(db, zohoSecrets), {
    email: "both-zoho@example.com",
    coupons30a: true,
    couponsDestin: true,
    next: "/my-places/",
  }, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(calls.some((call) => call.url === "https://api.resend.com/emails"), false);
  const rows = sheetRows(calls);
  assert.deepEqual(rows.find((row) => row.site === "30A"), {
    token: "token-30a",
    site: "30A",
    email: "both-zoho@example.com",
    coupons: true,
    sourcePage: ACCOUNT_SOURCE,
  });
  assert.deepEqual(rows.find((row) => row.site === "Destin"), {
    token: "token-destin",
    site: "Destin",
    email: "both-zoho@example.com",
    coupons: true,
    sourcePage: ACCOUNT_SOURCE,
  });
  const lists = zohoLists(calls);
  assert.equal(lists.length, 2);
  assert.deepEqual(lists.find((item) => item.listkey === "list-30a"), {
    listkey: "list-30a",
    source: "eatingon30a-account",
    resfmt: "JSON",
    contact: { "Contact Email": "both-zoho@example.com" },
    authorization: "Zoho-oauthtoken zoho-access",
    method: "POST",
  });
  assert.deepEqual(lists.find((item) => item.listkey === "list-destin"), {
    listkey: "list-destin",
    source: "eatingon30a-account",
    resfmt: "JSON",
    contact: { "Contact Email": "both-zoho@example.com" },
    authorization: "Zoho-oauthtoken zoho-access",
    method: "POST",
  });
  const tokenCall = calls.find((call) => call.url === ZOHO_TOKEN_URL);
  const tokenBody = new URLSearchParams(tokenCall.init.body);
  assert.equal(tokenBody.get("grant_type"), "refresh_token");
  assert.equal(tokenBody.get("client_id"), "zoho-client");
  assert.equal(tokenBody.get("client_secret"), "zoho-secret");
  assert.equal(tokenBody.get("refresh_token"), "zoho-refresh");
});

test("a missing sheet webhook still subscribes both Zoho lists", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = zohoCapture();
  const response = await requestSignIn(sheetEnv(db, { ...zohoSecrets, GOOGLE_SHEETS_WEBHOOK_URL: "" }), {
    email: "zoho-only@example.com",
    coupons30a: true,
    couponsDestin: true,
    next: "/my-places/",
  }, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(sheetRows(calls).length, 0);
  assert.deepEqual(zohoLists(calls).map((item) => item.listkey).sort(), ["list-30a", "list-destin"]);
});

test("a Destin-only coupon box uses the Destin Zoho list", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = zohoCapture();
  const response = await requestSignIn(sheetEnv(db, zohoSecrets), {
    email: "destin-zoho@example.com",
    coupons30a: false,
    couponsDestin: true,
    next: "/my-places/",
  }, fetchImpl);
  assert.equal(response.status, 200);
  assert.deepEqual(sheetRows(calls).map((row) => row.site), ["Destin"]);
  assert.deepEqual(zohoLists(calls).map((item) => item.listkey), ["list-destin"]);
});

test("a missing Destin Zoho list key skips that list and still subscribes 30A", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = zohoCapture();
  const response = await requestSignIn(sheetEnv(db, { ...zohoSecrets, ZOHO_LIST_KEY_DESTIN: "" }), {
    email: "no-destin-list@example.com",
    coupons30a: true,
    couponsDestin: true,
    next: "/my-places/",
  }, fetchImpl);
  assert.equal(response.status, 200);
  assert.deepEqual(sheetRows(calls).map((row) => row.site).sort(), ["30A", "Destin"]);
  assert.deepEqual(zohoLists(calls).map((item) => item.listkey), ["list-30a"]);
});

test("a Zoho list error does not fail an accepted magic link", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = zohoCapture(500);
  const response = await requestSignIn(sheetEnv(db, zohoSecrets), {
    email: "zoho-down@example.com",
    coupons30a: true,
    couponsDestin: true,
    next: "/my-places/",
  }, fetchImpl);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.match(payload.previewUrl, /\/v1\/verify\?/);
  assert.equal(sheetRows(calls).length, 2);
  assert.equal(zohoLists(calls).length, 2);
});

test("unchecked coupon boxes do not call Zoho", async () => {
  resetLimits();
  const db = memoryDb();
  const { calls, fetchImpl } = zohoCapture();
  const response = await requestSignIn(sheetEnv(db, zohoSecrets), {
    email: "quiet-zoho@example.com",
    coupons30a: false,
    couponsDestin: false,
    next: "/my-places/",
  }, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 0);
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
    ...zohoSecrets,
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

async function signIn(db, siteName, email) {
  const env = siteEnv(db, siteName);
  const origin = siteName === "30a" ? "http://127.0.0.1:8788" : "http://127.0.0.1:8789";
  const response = await handleAccount(new Request(`${origin}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, next: "/my-places/" }),
  }), env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  const verify = await handleAccounts(new Request(payload.previewUrl), accountsEnv(db));
  assert.equal(verify.status, 302);
  const finish = await handleAccount(new Request(verify.headers.get("location")), env);
  assert.equal(finish.status, 302);
  return { env, origin, token: cookieValue(finish.headers.get("set-cookie"), "ea_session") };
}

async function putSave(env, origin, token, body) {
  return handleAccount(new Request(`${origin}/api/account/saves`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: `ea_session=${token}` },
    body: JSON.stringify(body),
  }), env);
}

async function listSaves(env, origin, token) {
  const response = await handleAccount(new Request(`${origin}/api/account/saves`, {
    headers: { cookie: `ea_session=${token}` },
  }), env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  return payload.saves;
}

test("private notes stay on the save and leave with it", async () => {
  resetLimits();
  const db = memoryDb();
  const primary = await signIn(db, "30a", "notes@example.com");
  const other = await signIn(db, "30a", "other@example.com");

  let response = await putSave(primary.env, primary.origin, primary.token, {
    slug: "the-donut-hole-inlet-beach",
    name: "The Donut Hole",
    area: "Santa Rosa Beach",
    kind: "favorite",
    saved: true,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).note, "");

  response = await putSave(primary.env, primary.origin, primary.token, {
    slug: "the-donut-hole-inlet-beach",
    name: "The Donut Hole",
    area: "Santa Rosa Beach",
    kind: "favorite",
    note: "  Kids love the powdered ones. Ask for the booth by the window.  ",
  });
  let payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.saved, true);
  assert.equal(payload.note, "Kids love the powdered ones. Ask for the booth by the window.");

  response = await putSave(primary.env, primary.origin, primary.token, {
    slug: "the-donut-hole-inlet-beach",
    name: "The Donut Hole",
    area: "Santa Rosa Beach",
    kind: "favorite",
    saved: true,
  });
  assert.equal((await response.json()).note, "Kids love the powdered ones. Ask for the booth by the window.");

  response = await putSave(primary.env, primary.origin, primary.token, {
    slug: "the-donut-hole-inlet-beach",
    name: "The Donut Hole",
    area: "Santa Rosa Beach",
    kind: "want",
    saved: true,
  });
  assert.equal((await response.json()).note, "Kids love the powdered ones. Ask for the booth by the window.");

  const tooLong = await putSave(primary.env, primary.origin, primary.token, {
    slug: "the-donut-hole-inlet-beach",
    kind: "favorite",
    note: "x".repeat(281),
  });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error, "Keep the note under 280 characters.");

  response = await putSave(primary.env, primary.origin, primary.token, {
    slug: "the-donut-hole-inlet-beach",
    kind: "want",
    note: "Crawfish étouffée.",
  });
  assert.equal((await response.json()).note, "Crawfish étouffée.");
  let saves = await listSaves(primary.env, primary.origin, primary.token);
  assert.deepEqual(
    saves.filter((item) => item.slug === "the-donut-hole-inlet-beach").map((item) => [item.kind, item.note]).sort(),
    [
      ["favorite", "Crawfish étouffée."],
      ["want", "Crawfish étouffée."],
    ],
  );

  const outsider = await listSaves(other.env, other.origin, other.token);
  assert.deepEqual(outsider, []);

  response = await putSave(primary.env, primary.origin, primary.token, {
    slug: "the-donut-hole-inlet-beach",
    kind: "favorite",
    note: "   ",
  });
  assert.equal((await response.json()).note, "");
  saves = await listSaves(primary.env, primary.origin, primary.token);
  assert.equal(saves.find((item) => item.kind === "favorite").note, "");
  assert.equal(saves.find((item) => item.kind === "want").note, "");

  response = await putSave(primary.env, primary.origin, primary.token, {
    slug: "the-donut-hole-inlet-beach",
    kind: "favorite",
    site: "30a",
    saved: false,
  });
  assert.equal((await response.json()).saved, false);
  saves = await listSaves(primary.env, primary.origin, primary.token);
  assert.deepEqual(saves.map((item) => item.kind), ["want"]);

  response = await putSave(primary.env, primary.origin, primary.token, {
    slug: "the-donut-hole-inlet-beach",
    kind: "want",
    saved: false,
  });
  assert.equal((await response.json()).saved, false);
  assert.deepEqual(await listSaves(primary.env, primary.origin, primary.token), []);
});

test("a Destin note can be edited from the 30A list without creating a new save", async () => {
  resetLimits();
  const db = memoryDb();
  const home = await signIn(db, "30a", "home@example.com");
  const destin = await signIn(db, "destin", "home@example.com");

  let response = await putSave(destin.env, destin.origin, destin.token, {
    slug: "louisiana-lagniappe",
    name: "Louisiana Lagniappe",
    area: "Destin",
    kind: "want",
    saved: true,
    note: "Reservation under Marc.",
  });
  assert.equal(response.status, 200);

  response = await putSave(home.env, home.origin, home.token, {
    slug: "louisiana-lagniappe",
    name: "Louisiana Lagniappe",
    area: "Destin",
    kind: "want",
    site: "destin",
    saved: true,
    note: "Reservation under Marc. Crawfish étouffée.",
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).note, "Reservation under Marc. Crawfish étouffée.");

  const blocked = await putSave(home.env, home.origin, home.token, {
    slug: "new-destin-place",
    name: "New Destin Place",
    area: "Destin",
    kind: "favorite",
    site: "destin",
    saved: true,
    note: "Should not create a save.",
  });
  assert.equal(blocked.status, 400);

  const saves = await listSaves(home.env, home.origin, home.token);
  assert.deepEqual(saves.map((item) => [item.site, item.slug, item.note]), [
    ["destin", "louisiana-lagniappe", "Reservation under Marc. Crawfish étouffée."],
  ]);
});

test("my places opt-in appends sheet rows for the session email and skips Resend", async () => {
  resetLimits();
  const db = memoryDb();
  const token = await sessionFor(db, "session@example.com");
  const { calls, fetchImpl } = captureFetch();
  const response = await postCoupons(sheetEnv(db), token, {
    email: "someone-else@example.com",
    coupons30a: true,
    couponsDestin: true,
  }, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(calls.some((call) => String(call.url).includes("resend.com")), false);
  assert.equal(calls.some((call) => String(call.url).includes("zoho.com")), false);
  const rows = sheetRows(calls);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((row) => row.site === "30A"), {
    token: "token-30a",
    site: "30A",
    email: "session@example.com",
    coupons: true,
    sourcePage: PLACES_SOURCE,
  });
  assert.deepEqual(rows.find((row) => row.site === "Destin"), {
    token: "token-destin",
    site: "Destin",
    email: "session@example.com",
    coupons: true,
    sourcePage: PLACES_SOURCE,
  });
  assert.equal(rows.some((row) => row.email === "someone-else@example.com"), false);
});

test("my places opt-in subscribes both Zoho lists for the session email", async () => {
  resetLimits();
  const db = memoryDb();
  const token = await sessionFor(db, "places-zoho@example.com");
  const { calls, fetchImpl } = zohoCapture();
  const response = await postCoupons(sheetEnv(db, zohoSecrets), token, {
    email: "someone-else@example.com",
    coupons30a: true,
    couponsDestin: true,
  }, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(calls.some((call) => String(call.url).includes("resend.com")), false);
  assert.equal(sheetRows(calls).length, 2);
  const lists = zohoLists(calls);
  assert.deepEqual(lists.map((item) => item.listkey).sort(), ["list-30a", "list-destin"]);
  for (const item of lists) {
    assert.equal(item.source, "eatingon30a-account");
    assert.deepEqual(item.contact, { "Contact Email": "places-zoho@example.com" });
  }
  assert.equal(lists.some((item) => item.contact["Contact Email"] === "someone-else@example.com"), false);
});

test("a Zoho failure does not fail a signed-in coupon opt-in", async () => {
  resetLimits();
  const db = memoryDb();
  const token = await sessionFor(db, "places-zoho-down@example.com");
  const response = await postCoupons(sheetEnv(db, zohoSecrets), token, {
    coupons30a: true,
    couponsDestin: true,
  }, (url) => {
    if (url === ZOHO_TOKEN_URL || url === ZOHO_LIST_URL) return Promise.reject(new Error("zoho down"));
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("my places opt-in appends only the checked sheet row", async () => {
  resetLimits();
  const db = memoryDb();
  const token = await sessionFor(db, "one-list@example.com");
  const destinOnly = captureFetch();
  let response = await postCoupons(sheetEnv(db), token, {
    coupons30a: false,
    couponsDestin: true,
  }, destinOnly.fetchImpl);
  assert.equal(response.status, 200);
  assert.deepEqual(sheetRows(destinOnly.calls).map((row) => [row.site, row.token, row.email]), [
    ["Destin", "token-destin", "one-list@example.com"],
  ]);

  const thirtyOnly = captureFetch();
  response = await postCoupons(sheetEnv(db), token, {
    coupons30a: "yes",
    couponsDestin: "",
  }, thirtyOnly.fetchImpl);
  assert.equal(response.status, 200);
  assert.deepEqual(sheetRows(thirtyOnly.calls), [{
    token: "token-30a",
    site: "30A",
    email: "one-list@example.com",
    coupons: true,
    sourcePage: PLACES_SOURCE,
  }]);
});

test("my places opt-in skips a missing Destin token", async () => {
  resetLimits();
  const db = memoryDb();
  const token = await sessionFor(db, "no-destin@example.com");
  const { calls, fetchImpl } = captureFetch();
  const response = await postCoupons(
    sheetEnv(db, { GOOGLE_SHEETS_WEBHOOK_TOKEN_DESTIN: "" }),
    token,
    { coupons30a: true, couponsDestin: true },
    fetchImpl,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(sheetRows(calls).map((row) => row.site), ["30A"]);
});

test("my places opt-in without a box does not call the sheet", async () => {
  resetLimits();
  const db = memoryDb();
  const token = await sessionFor(db, "none@example.com");
  const { calls, fetchImpl } = captureFetch();
  const response = await postCoupons(sheetEnv(db, zohoSecrets), token, {
    email: "none@example.com",
    coupons30a: false,
    couponsDestin: false,
  }, fetchImpl);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Choose Eating on 30A, Eating in Destin, or both.");
  assert.equal(calls.length, 0);
});

test("my places opt-in without a session does not call the sheet", async () => {
  const { calls, fetchImpl } = captureFetch();
  const response = await postCoupons(sheetEnv(memoryDb(), zohoSecrets), "", {
    email: "guest@example.com",
    coupons30a: true,
    couponsDestin: true,
  }, fetchImpl);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "Sign in to save this.");
  assert.equal(calls.length, 0);
  assert.equal(calls.some((call) => String(call.url).includes("resend.com")), false);
});

test("a sheet failure does not fail a signed-in coupon opt-in", async () => {
  resetLimits();
  const db = memoryDb();
  const token = await sessionFor(db, "sheet-down-places@example.com");
  const response = await postCoupons(sheetEnv(db), token, {
    coupons30a: true,
    couponsDestin: true,
  }, () => Promise.reject(new Error("sheet down")));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("a form post from My places uses the session email", async () => {
  resetLimits();
  const db = memoryDb();
  const token = await sessionFor(db, "form-places@example.com");
  const { calls, fetchImpl } = captureFetch();
  const response = await postCoupons(
    sheetEnv(db),
    token,
    new URLSearchParams({
      email: "typed@example.com",
      couponsDestin: "yes",
    }),
    fetchImpl,
    { "content-type": "application/x-www-form-urlencoded" },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(sheetRows(calls), [{
    token: "token-destin",
    site: "Destin",
    email: "form-places@example.com",
    coupons: true,
    sourcePage: PLACES_SOURCE,
  }]);
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
