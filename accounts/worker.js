/**
 * Shared account store for eatingon30a.com and eatingindestin.com.
 *
 * The two guides do not share a parent domain, so one cookie cannot be read
 * on both hosts. This Worker keeps the users, magic links, and saves in D1.
 * It sets a first-party cookie, ea_central, on its own host only. Each guide
 * then exchanges a one-time code for its own first-party ea_session cookie.
 * Do not set a Domain attribute on either cookie.
 *
 * Magic-link mail uses Resend when RESEND_API_KEY and SUBSCRIBE_FROM are set.
 * ACCOUNTS_SHARED_SECRET authenticates the two site Workers.
 * MAGIC_LINK_PREVIEW=1 includes the verify URL in the JSON response. Leave it
 * unset in production.
 */

import { SAVE_NOTE_SQL, SCHEMA_SQL } from "./schema.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SITES = new Set(["30a", "destin"]);
const KINDS = new Set(["favorite", "want"]);
const NOTE_MAX = 280;
const LINK_MS = 20 * 60 * 1000;
const CODE_MS = 2 * 60 * 1000;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const PRODUCTION_HOSTS = {
  "30a": new Set(["www.eatingon30a.com", "eatingon30a.com", "eatingon30a.352marc.workers.dev"]),
  destin: new Set(["www.eatingindestin.com", "eatingindestin.com", "eatingindestin.352marc.workers.dev"]),
};

const hits = new Map();
const schemaReady = new WeakMap();

export function resetLimits() {
  hits.clear();
}

function columnNames(info) {
  const rows = info && info.results ? info.results : [];
  return rows.map((column) => column && column.name).filter(Boolean);
}

export async function ensureSchema(db) {
  const statements = SCHEMA_SQL.split(";").map((part) => part.trim()).filter(Boolean);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
  const names = columnNames(await db.prepare("PRAGMA table_info(saves)").all());
  if (names.includes("note")) return;
  try {
    await db.prepare(SAVE_NOTE_SQL).run();
  } catch (error) {
    const message = String((error && error.message) || error);
    if (!/duplicate column/i.test(message)) throw error;
  }
}

function ready(env) {
  const db = env && env.DB;
  if (!db) return Promise.reject(new Error("database"));
  let pending = schemaReady.get(db);
  if (!pending) {
    pending = ensureSchema(db).catch((error) => {
      schemaReady.delete(db);
      throw error;
    });
    schemaReady.set(db, pending);
  }
  return pending;
}

function changed(result) {
  if (!result) return 0;
  if (result.meta && typeof result.meta.changes === "number") return result.meta.changes;
  if (typeof result.changes === "number") return result.changes;
  return 0;
}

export function safeNext(value) {
  const text = String(value || "");
  if (!text) return "/my-places/";
  if (!text.startsWith("/") || text.startsWith("//") || text.startsWith("/api/")) return null;
  if (text.includes("\\") || text.includes("://") || /[\r\n]/.test(text)) return null;
  if (text.length > 300) return null;
  return text;
}

function localHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function parseReturnTo(returnTo, site) {
  if (!SITES.has(site)) return null;
  let url;
  try {
    url = new URL(String(returnTo || ""));
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;
  if (url.pathname !== "/api/account/finish") return null;
  const host = url.hostname.toLowerCase();
  const local = url.protocol === "http:" && localHost(host);
  const prod = url.protocol === "https:" && PRODUCTION_HOSTS[site].has(host);
  if (!local && !prod) return null;
  for (const key of url.searchParams.keys()) {
    if (key !== "next") return null;
  }
  const next = url.searchParams.get("next");
  if (next != null && safeNext(next) !== next) return null;
  return { href: url.toString(), site, origin: url.origin };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorized(request, env) {
  const expected = String((env && env.ACCOUNTS_SHARED_SECRET) || "");
  if (!expected) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;
  const left = await sha256(token);
  const right = await sha256(expected);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0 && left.length === right.length;
}

function tooMany(key, max) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const prev = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (prev.length >= max) {
    hits.set(key, prev);
    return true;
  }
  prev.push(now);
  hits.set(key, prev);
  return false;
}

function json(body, status = 200, extra) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (extra) extra.forEach((value, key) => headers.append(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function textPage(message, status) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(message)}</title></head><body style="margin:0;background:#fbf7f1;color:#172421;font-family:Georgia,serif"><main style="max-width:36rem;margin:4rem auto;padding:0 1.25rem"><h1>${escapeHtml(message)}</h1></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function redirect(location, cookie) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function cookie(name, value, request, maxAge) {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [`${name}=${value}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function resendReady(env) {
  const key = env && env.RESEND_API_KEY;
  const from = env && env.SUBSCRIBE_FROM;
  if (!key || !from) return null;
  return { key, from };
}

function publicOrigin(request, env) {
  const configured = String((env && env.ACCOUNTS_PUBLIC_ORIGIN) || "").replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

function cleanLine(value, max) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > max) return "";
  return text;
}

function parseNote(value) {
  if (typeof value !== "string") return { ok: false, error: "That note could not be saved." };
  const text = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (text.length > NOTE_MAX) return { ok: false, error: "Keep the note under 280 characters." };
  return { ok: true, text };
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}

async function userBySession(db, token, site) {
  if (!token || !SITES.has(site)) return null;
  const hash = await sha256(token);
  const row = await db.prepare(
    `SELECT users.id, users.email, users.marketing_opt_in, sessions.site
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.site = ? AND sessions.expires_at > ?`,
  ).bind(hash, site, Date.now()).first();
  return row || null;
}

function userPayload(row) {
  return { email: row.email, marketingOptIn: Number(row.marketing_opt_in) === 1 };
}

async function sendMagicLink(env, email, verifyUrl, fetchImpl) {
  const ready = resendReady(env);
  if (!ready) return { delivered: false };
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ready.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: ready.from,
      to: [email],
      subject: "Your sign-in link for Eating on 30A and Eating in Destin",
      text: [
        "Use the link below to sign in. It works once and expires in 20 minutes.",
        "",
        verifyUrl,
        "",
        "If you did not ask for this link, you can ignore this email.",
        "",
        "This account works on Eating on 30A and Eating in Destin.",
      ].join("\n"),
    }),
  });
  return { delivered: response.ok };
}

async function magicLink(request, env, fetchImpl) {
  if (!(await authorized(request, env))) return json({ ok: false, error: "Unauthorized." }, 401);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "Send the request as JSON." }, 400);
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return json({ ok: false, error: "Enter a valid email." }, 400);
  const site = String(body.site || "");
  const parsed = parseReturnTo(body.returnTo, site);
  if (!parsed) return json({ ok: false, error: "That return address is not allowed." }, 400);
  const caller = request.headers.get("x-account-site") || "";
  if (caller !== site) return json({ ok: false, error: "That return address is not allowed." }, 400);
  const ip = request.headers.get("x-forwarded-for") || "";
  if (tooMany(`email:${email}`, 5) || (ip && tooMany(`ip:${ip}`, 20))) {
    return json({ ok: false, error: "Please wait a while and try again." }, 429);
  }
  const preview = env.MAGIC_LINK_PREVIEW === "1";
  if (!preview && !resendReady(env)) return json({ ok: false, error: "Sign-in email is not set up yet." }, 503);

  const now = Date.now();
  const marketing = body.marketingOptIn === true;
  let user = await env.DB.prepare("SELECT id, marketing_opt_in FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, marketing_opt_in, created_site, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, email, marketing ? 1 : 0, site, now, now).run();
    user = { id, marketing_opt_in: marketing ? 1 : 0 };
  } else if (marketing && Number(user.marketing_opt_in) !== 1) {
    await env.DB.prepare("UPDATE users SET marketing_opt_in = 1, updated_at = ? WHERE id = ?").bind(now, user.id).run();
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  await env.DB.prepare(
    "INSERT INTO magic_links (token_hash, user_id, return_to, site, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)",
  ).bind(tokenHash, user.id, parsed.href, site, now + LINK_MS).run();

  const verifyUrl = `${publicOrigin(request, env)}/v1/verify?token=${token}&return=${encodeURIComponent(parsed.href)}`;
  const mail = await sendMagicLink(env, email, verifyUrl, fetchImpl);
  if (!mail.delivered && !preview) return json({ ok: false, error: "The sign-in email could not be sent." }, 502);
  console.log(JSON.stringify({ event: "magic_link", site, delivered: mail.delivered, preview }));
  const payload = { ok: true, delivered: mail.delivered };
  if (preview) payload.previewUrl = verifyUrl;
  return json(payload);
}

async function verify(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const returnTo = url.searchParams.get("return") || "";
  if (!token || !returnTo) return textPage("That sign-in link is not valid.", 400);
  const hash = await sha256(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT user_id, return_to, site, expires_at, used_at FROM magic_links WHERE token_hash = ?",
  ).bind(hash).first();
  if (!row || row.used_at || Number(row.expires_at) <= now || row.return_to !== returnTo) {
    return textPage("That sign-in link expired. Request a new one.", 400);
  }
  const claimed = await env.DB.prepare(
    "UPDATE magic_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
  ).bind(now, hash).run();
  if (changed(claimed) !== 1) return textPage("That sign-in link expired. Request a new one.", 400);

  const central = randomToken();
  const code = randomToken();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, site, expires_at, created_at) VALUES (?, ?, 'central', ?, ?)",
  ).bind(await sha256(central), row.user_id, now + SESSION_MS, now).run();
  await env.DB.prepare(
    "INSERT INTO exchange_codes (code_hash, user_id, site, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
  ).bind(await sha256(code), row.user_id, row.site, now + CODE_MS).run();

  const dest = new URL(row.return_to);
  dest.searchParams.set("code", code);
  return redirect(dest.toString(), cookie("ea_central", central, request, Math.floor(SESSION_MS / 1000)));
}

async function continueSession(request, env) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return") || "";
  const parsed = parseReturnTo(returnTo, url.searchParams.get("site") || "");
  if (!parsed) return textPage("That return address is not allowed.", 400);
  const central = readCookie(request, "ea_central");
  const hash = central ? await sha256(central) : "";
  const now = Date.now();
  const row = hash
    ? await env.DB.prepare(
      "SELECT user_id FROM sessions WHERE token_hash = ? AND site = 'central' AND expires_at > ?",
    ).bind(hash, now).first()
    : null;
  if (!row) {
    const dest = new URL(parsed.href);
    dest.searchParams.set("need", "1");
    return redirect(dest.toString());
  }
  const code = randomToken();
  await env.DB.prepare(
    "INSERT INTO exchange_codes (code_hash, user_id, site, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
  ).bind(await sha256(code), row.user_id, parsed.site, now + CODE_MS).run();
  const dest = new URL(parsed.href);
  dest.searchParams.set("code", code);
  return redirect(dest.toString());
}

async function exchange(request, env) {
  if (!(await authorized(request, env))) return json({ ok: false, error: "Unauthorized." }, 401);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "Send the request as JSON." }, 400);
  const site = String(body.site || "");
  const caller = request.headers.get("x-account-site") || "";
  if (!SITES.has(site) || caller !== site) return json({ ok: false, error: "That code is not valid." }, 400);
  const code = String(body.code || "");
  if (!/^[a-f0-9]{64}$/.test(code)) return json({ ok: false, error: "That code is not valid." }, 400);
  const hash = await sha256(code);
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT user_id, site, expires_at, used_at FROM exchange_codes WHERE code_hash = ?",
  ).bind(hash).first();
  if (!row || row.used_at || Number(row.expires_at) <= now || row.site !== site) {
    return json({ ok: false, error: "That code is not valid." }, 400);
  }
  const claimed = await env.DB.prepare(
    "UPDATE exchange_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL",
  ).bind(now, hash).run();
  if (changed(claimed) !== 1) return json({ ok: false, error: "That code is not valid." }, 400);
  const token = randomToken();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, site, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(await sha256(token), row.user_id, site, now + SESSION_MS, now).run();
  const user = await env.DB.prepare(
    "SELECT email, marketing_opt_in FROM users WHERE id = ?",
  ).bind(row.user_id).first();
  return json({ ok: true, token, user: userPayload(user) });
}

async function me(request, env) {
  if (!(await authorized(request, env))) return json({ ok: false, error: "Unauthorized." }, 401);
  const site = request.headers.get("x-account-site") || "";
  const row = await userBySession(env.DB, request.headers.get("x-session") || "", site);
  if (!row) return json({ ok: true, user: null });
  return json({ ok: true, user: userPayload(row) });
}

async function logout(request, env) {
  if (!(await authorized(request, env))) return json({ ok: false, error: "Unauthorized." }, 401);
  const site = request.headers.get("x-account-site") || "";
  const row = await userBySession(env.DB, request.headers.get("x-session") || "", site);
  if (row) await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id).run();
  return json({ ok: true });
}

async function listSaves(request, env) {
  if (!(await authorized(request, env))) return json({ ok: false, error: "Unauthorized." }, 401);
  const site = request.headers.get("x-account-site") || "";
  const row = await userBySession(env.DB, request.headers.get("x-session") || "", site);
  if (!row) return json({ ok: false, error: "Sign in to see your places." }, 401);
  const result = await env.DB.prepare(
    "SELECT site, slug, name, area, kind, note, created_at FROM saves WHERE user_id = ? ORDER BY created_at DESC, name COLLATE NOCASE",
  ).bind(row.id).all();
  const saves = (result.results || []).map((item) => ({
    site: item.site,
    slug: item.slug,
    name: item.name,
    area: item.area,
    kind: item.kind,
    note: item.note ? String(item.note) : "",
    createdAt: item.created_at,
  }));
  return json({ ok: true, saves });
}

async function writeNote(db, userId, site, slug, note) {
  await db.prepare(
    "UPDATE saves SET note = ? WHERE user_id = ? AND site = ? AND slug = ?",
  ).bind(note, userId, site, slug).run();
}

async function putSave(request, env) {
  if (!(await authorized(request, env))) return json({ ok: false, error: "Unauthorized." }, 401);
  const caller = request.headers.get("x-account-site") || "";
  const row = await userBySession(env.DB, request.headers.get("x-session") || "", caller);
  if (!row) return json({ ok: false, error: "Sign in to save this place." }, 401);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "Send the request as JSON." }, 400);
  const kind = String(body.kind || "");
  const site = String(body.site || "");
  const slug = String(body.slug || "");
  const hasNote = Object.hasOwn(body, "note");
  if (!KINDS.has(kind) || !SITES.has(site) || !SLUG.test(slug) || slug.length > 140) {
    return json({ ok: false, error: "That place could not be saved." }, 400);
  }
  let note = "";
  if (hasNote) {
    const parsed = parseNote(body.note);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
    note = parsed.text;
  }
  const saving = body.saved === true;
  if (body.saved === false || (!saving && !hasNote)) {
    await env.DB.prepare(
      "DELETE FROM saves WHERE user_id = ? AND site = ? AND slug = ? AND kind = ?",
    ).bind(row.id, site, slug, kind).run();
    return json({ ok: true, saved: false });
  }
  const existing = await env.DB.prepare(
    "SELECT note FROM saves WHERE user_id = ? AND site = ? AND slug = ? AND kind = ?",
  ).bind(row.id, site, slug, kind).first();
  // A note write must not create a save, and must not turn one off.
  // Cross-guide calls can edit a note on a row that already exists.
  if (!saving || site !== caller) {
    if (!existing) {
      const error = site !== caller
        ? "Save this place on its own guide."
        : "Save this place before adding a note.";
      return json({ ok: false, error }, 400);
    }
    if (!hasNote) return json({ ok: false, error: "Save this place on its own guide." }, 400);
    await writeNote(env.DB, row.id, site, slug, note);
    return json({ ok: true, saved: true, note });
  }
  const name = cleanLine(body.name, 160);
  if (!name) return json({ ok: false, error: "That place could not be saved." }, 400);
  const area = cleanLine(body.area, 120);
  let storedNote = "";
  if (hasNote) storedNote = note;
  else if (existing && existing.note) storedNote = String(existing.note);
  else if (!existing) {
    const sibling = await env.DB.prepare(
      "SELECT note FROM saves WHERE user_id = ? AND site = ? AND slug = ? AND note != '' LIMIT 1",
    ).bind(row.id, site, slug).first();
    storedNote = sibling && sibling.note ? String(sibling.note) : "";
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO saves (user_id, site, slug, name, area, kind, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, site, slug, kind) DO UPDATE SET
       name = excluded.name,
       area = excluded.area,
       note = excluded.note`,
  ).bind(row.id, site, slug, name, area, kind, storedNote, now).run();
  if (hasNote) await writeNote(env.DB, row.id, site, slug, note);
  return json({ ok: true, saved: true, note: storedNote });
}

export async function handleAccounts(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/v1/health") return json({ ok: true });
  if (!env || !env.DB) return json({ ok: false, error: "Accounts database is not set up yet." }, 503);
  try {
    await ready(env);
  } catch (error) {
    console.log(JSON.stringify({ event: "accounts_schema", message: error && error.message }));
    return json({ ok: false, error: "Accounts database is not set up yet." }, 503);
  }
  if (request.method === "POST" && url.pathname === "/v1/magic-link") return magicLink(request, env, fetchImpl);
  if (request.method === "GET" && url.pathname === "/v1/verify") return verify(request, env);
  if (request.method === "GET" && url.pathname === "/v1/continue") return continueSession(request, env);
  if (request.method === "POST" && url.pathname === "/v1/exchange") return exchange(request, env);
  if (request.method === "GET" && url.pathname === "/v1/me") return me(request, env);
  if (request.method === "POST" && url.pathname === "/v1/logout") return logout(request, env);
  if (request.method === "GET" && url.pathname === "/v1/saves") return listSaves(request, env);
  if (request.method === "PUT" && url.pathname === "/v1/saves") return putSave(request, env);
  return json({ ok: false, error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleAccounts(request, env);
    } catch (error) {
      console.log(JSON.stringify({ event: "accounts_error", message: error && error.message }));
      return json({ ok: false, error: "Something went wrong." }, 500);
    }
  },
};
