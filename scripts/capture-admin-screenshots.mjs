/**
 * Local harness for admin + public screenshots (Playwright + worker.fetch).
 * Usage: node scripts/capture-admin-screenshots.mjs
 */

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { handleAccount } from "../account-api.js";
import { handleAdmin } from "../admin-api.js";
import { LISTINGS_SQL, SCHEMA_SQL } from "../accounts/schema.js";
import { handleAccounts, resetLimits } from "../accounts/worker.js";
import worker from "../worker.js";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const OUT_DIR = "/opt/cursor/artifacts";
const PORT = 9876;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ACCOUNTS_ORIGIN = "http://127.0.0.1:8787";

function contentTypeFor(pathname) {
  if (pathname.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".ico")) return "image/x-icon";
  return "text/html; charset=utf-8";
}

function diskAssets() {
  return {
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/404.html") {
        return new Response("missing page", { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      let rel = pathname;
      if (rel.endsWith("/")) rel += "index.html";
      if (rel === "/") rel = "/index.html";
      const file = join(REPO_ROOT, rel);
      if (!existsSync(file)) return new Response("not found", { status: 404 });
      return new Response(readFileSync(file), { headers: { "content-type": contentTypeFor(rel) } });
    },
  };
}

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

function memoryBucket() {
  const objects = new Map();
  return {
    async put(key, body) {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, bytes);
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

function accountsEnv(db, bucket) {
  return {
    DB: db,
    ACCOUNTS_SHARED_SECRET: "test-secret",
    ACCOUNTS_PUBLIC_ORIGIN: ACCOUNTS_ORIGIN,
    MAGIC_LINK_PREVIEW: "1",
    PHOTOS: bucket,
  };
}

function siteEnv(db, bucket) {
  const shared = accountsEnv(db, bucket);
  return {
    ACCOUNT_SITE: "30a",
    ACCOUNTS_SHARED_SECRET: "test-secret",
    ACCOUNTS_ORIGIN: ACCOUNTS_ORIGIN,
    ACCOUNTS: { fetch: (request) => handleAccounts(request, shared) },
    ASSETS: diskAssets(),
    PHOTOS: bucket,
  };
}

function cookieValue(header, name) {
  const pair = String(header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!pair) throw new Error(`missing ${name}`);
  return pair.slice(name.length + 1);
}

async function signIn(db, env, email) {
  resetLimits();
  const requested = await handleAccount(new Request(`${ORIGIN}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, next: "/admin/" }),
  }), env);
  const body = await requested.json();
  if (!body.ok) throw new Error(body.error || "sign-in request failed");
  const verified = await handleAccounts(new Request(body.previewUrl), accountsEnv(db, env.PHOTOS));
  const finished = await handleAccount(new Request(verified.headers.get("location")), env);
  return cookieValue(finished.headers.get("set-cookie"), "ea_session");
}

function adminRequest(path, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("cookie", `ea_session=${token}`);
  return new Request(`${ORIGIN}${path}`, { ...options, headers });
}

function startServer(env) {
  return createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        if (Array.isArray(value)) value.forEach((part) => headers.append(key, part));
        else headers.set(key, value);
      }
      const request = new Request(`${ORIGIN}${req.url}`, {
        method: req.method,
        headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      });
      const response = await worker.fetch(request, env);
      const outHeaders = {};
      response.headers.forEach((value, key) => {
        outHeaders[key] = value;
      });
      res.writeHead(response.status, outHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error && error.message ? error.message : error));
    }
  });
}

async function main() {
  assertListingMigration();
  mkdirSync(OUT_DIR, { recursive: true });
  const db = memoryDb();
  const bucket = memoryBucket();
  const env = siteEnv(db, bucket);
  const token = await signIn(db, env, "marc@whpinc.com");

  const cafeSlug = "seagrove-village-market-cafe-seagrove-beach";
  const deactivated = await handleAdmin(adminRequest(`/api/admin/listings/${cafeSlug}/active`, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ site: "30a", active: false }),
  }), env);
  if (deactivated.status !== 200) {
    throw new Error(`deactivate failed: ${JSON.stringify(await deactivated.json())}`);
  }

  const server = startServer(env);
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  await context.addCookies([{
    name: "ea_session",
    value: token,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);

  const page = await context.newPage();
  await page.goto(`${ORIGIN}/admin/?site=30a`, { waitUntil: "networkidle" });
  await page.waitForSelector("table.admin-table");
  await page.fill("#admin-search", "Market");
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, "admin-listing-visibility-column.png"), fullPage: true });

  await page.goto(`${ORIGIN}/admin/?site=30a`, { waitUntil: "networkidle" });
  await page.waitForSelector("table.admin-table");
  await page.fill("#admin-search", "Bud");
  await page.click('[data-edit="bud-and-alleys-seaside"]');
  await page.waitForSelector(".admin-visibility");
  await page.screenshot({ path: join(OUT_DIR, "admin-editor-deactivate-box.png"), fullPage: true });

  await page.goto(`${ORIGIN}/areas/seagrove-beach/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".town-title");
  await page.screenshot({ path: join(OUT_DIR, "seagrove-beach-town-cafe-hidden.png"), fullPage: true });

  await browser.close();
  server.close();

  console.log(JSON.stringify({
    ok: true,
    files: [
      "admin-listing-visibility-column.png",
      "admin-editor-deactivate-box.png",
      "seagrove-beach-town-cafe-hidden.png",
    ].map((name) => join(OUT_DIR, name)),
  }, null, 2));
}

function assertListingMigration() {
  const file = readFileSync(join(REPO_ROOT, "accounts/migrations/0003_listings.sql"), "utf8").trim();
  if (file !== LISTINGS_SQL) throw new Error("listing migration drift");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
