/**
 * Static assets are served by the assets binding.
 * /api/subscribe accepts a coupon signup and /api/listing accepts a restaurant
 * correction, edit, deletion, new listing, or other note. A restaurant name
 * is optional. When the secrets exist, both
 * email CONTACT_EMAIL through Resend (https://resend.com). Nothing is emailed
 * until all three are set: RESEND_API_KEY, SUBSCRIBE_FROM (a verified Resend
 * sender), CONTACT_EMAIL.
 * A coupon signup is also appended through an Apps Script webhook when both
 * GOOGLE_SHEETS_WEBHOOK_URL and GOOGLE_SHEETS_WEBHOOK_TOKEN are set. `delivered`
 * is only the Resend result. `recorded` is true only when that webhook returns
 * JSON with ok: true. An HTTP 200 HTML error page, any other non-JSON body,
 * and {ok:false} stay recorded: false. A Sheets miss does not fail the signup
 * when Resend accepted it.
 * sourcePage is the live homepage. site.config.json origin stays the workers.dev preview.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHEETS_SITE = "30A";
const SOURCE_PAGE = "https://www.eatingon30a.com/";
const LISTING_TYPES = {
  update: "Update",
  edit: "Edit",
  deletion: "Deletion",
  new: "New listing",
  other: "Other",
};
const LISTING_TYPE_ERROR = "Choose update, edit, deletion, new listing, or other.";
export const MAX_BODY = 32000;
const WINDOW_MS = 60 * 1000;
export const MAX_PER_WINDOW = 5;
const recentHits = new Map();

export function resetFormRateLimit() {
  recentHits.clear();
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function rateLimited(ip, now = Date.now()) {
  const stamps = (recentHits.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (stamps.length >= MAX_PER_WINDOW) {
    recentHits.set(ip, stamps);
    return true;
  }
  stamps.push(now);
  recentHits.set(ip, stamps);
  if (recentHits.size > 1000) {
    for (const [key, times] of recentHits) {
      const fresh = times.filter((time) => now - time < WINDOW_MS);
      if (fresh.length) recentHits.set(key, fresh);
      else recentHits.delete(key);
    }
  }
  return false;
}

export function honeypotFilled(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return ["company", "hp_field", "website"].some((key) => String(data[key] ?? "").trim() !== "");
}

export function parseSubscribe(body) {
  if (!body || typeof body !== "object") return { error: "Send the signup as JSON." };
  const email = String(body.email || "").trim();
  if (!EMAIL.test(email) || email.length > 200) return { error: "Enter a valid email." };
  const audience = String(body.audience || "").trim().toLowerCase();
  if (audience && audience !== "local" && audience !== "visitor") return { error: "Choose Local or Visitor." };
  return { value: { email, audience, coupons: Boolean(body.coupons) } };
}

function resendReady(env) {
  const key = env && env.RESEND_API_KEY;
  const to = env && env.CONTACT_EMAIL;
  const from = env && env.SUBSCRIBE_FROM;
  if (!key || !to || !from) return null;
  return { key, to, from };
}

async function postResend(env, message, fetchImpl, failure) {
  const ready = resendReady(env);
  if (!ready) return { ok: true, delivered: false };
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ready.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: ready.from, to: [ready.to], ...message }),
  });
  if (!response.ok) return { ok: false, delivered: false, error: failure };
  return { ok: true, delivered: true };
}

function sheetsReady(env) {
  const url = env && env.GOOGLE_SHEETS_WEBHOOK_URL;
  const token = env && env.GOOGLE_SHEETS_WEBHOOK_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

function sheetPayload(payload, token) {
  const body = {
    token,
    site: SHEETS_SITE,
    email: payload.email,
    coupons: Boolean(payload.coupons),
    sourcePage: SOURCE_PAGE,
  };
  if (payload.audience === "local" || payload.audience === "visitor") body.audience = payload.audience;
  return body;
}

async function sheetsAccepted(response) {
  if (!response || !response.ok) return false;
  let body;
  try {
    body = await response.json();
  } catch {
    return false;
  }
  return Boolean(body && typeof body === "object" && body.ok === true);
}

async function recordSubscribe(payload, env, fetchImpl) {
  const ready = sheetsReady(env);
  if (!ready) return { recorded: false };
  try {
    const response = await fetchImpl(ready.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sheetPayload(payload, ready.token)),
    });
    return { recorded: await sheetsAccepted(response) };
  } catch {
    return { recorded: false };
  }
}

export async function deliverSubscribe(payload, env, fetchImpl = fetch) {
  const who = payload.audience === "local" ? "Local" : payload.audience === "visitor" ? "Visitor" : "Not specified";
  const [mail, sheet] = await Promise.all([
    postResend(
      env,
      {
        subject: "Eating on 30A coupon signup",
        text: `Email: ${payload.email}\nI am a: ${who}\nCoupons: ${payload.coupons ? "yes" : "no"}`,
      },
      fetchImpl,
      "The signup could not be sent.",
    ),
    recordSubscribe(payload, env, fetchImpl),
  ]);
  return { ...mail, recorded: sheet.recorded };
}

function oneLine(value, max) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > max) return "";
  return text;
}

export function parseListing(body) {
  if (!body || typeof body !== "object") return { error: "Send the request as JSON." };
  const restaurant = oneLine(body.restaurant, 160);
  if (String(body.restaurant || "").trim() && !restaurant) {
    return { error: "Keep the restaurant name under 160 characters." };
  }
  const town = oneLine(body.town, 120);
  if (String(body.town || "").trim() && !town) return { error: "Town is too long." };
  const type = String(body.type || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(LISTING_TYPES, type)) {
    return { error: LISTING_TYPE_ERROR };
  }
  const details = String(body.details || "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!details) return { error: "Tell us what should change." };
  if (details.length > 4000) return { error: "Keep the details under 4,000 characters." };
  const name = oneLine(body.name, 120);
  if (!name) return { error: "Enter your name." };
  const email = String(body.email || "").trim();
  if (!EMAIL.test(email) || email.length > 200) return { error: "Enter a valid email." };
  return { value: { restaurant, town, type, details, name, email } };
}

export async function deliverListing(payload, env, fetchImpl = fetch) {
  const label = LISTING_TYPES[payload.type] || payload.type;
  const town = payload.town || "Not specified";
  const restaurant = payload.restaurant || "Not specified";
  return postResend(
    env,
    {
      reply_to: payload.email,
      subject: `Eating on 30A listing: ${label} — ${restaurant}`,
      text: `Request: ${label}\nRestaurant: ${restaurant}\nTown: ${town}\nFrom: ${payload.name} <${payload.email}>\n\n${payload.details}`,
    },
    fetchImpl,
    "The request could not be sent.",
  );
}

export const CANONICAL_HOST = "www.eatingon30a.com";

export function canonicalRedirect(url, method = "GET") {
  const host = String(url.hostname || "").toLowerCase();
  if (host !== "eatingon30a.com") return null;
  const target = new URL(url.toString());
  target.protocol = "https:";
  target.hostname = CANONICAL_HOST;
  const verb = String(method || "GET").toUpperCase();
  const status = verb === "GET" || verb === "HEAD" ? 301 : 308;
  return new Response(null, { status, headers: { location: target.toString() } });
}

export function robotsTagForHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host.endsWith(".workers.dev")) return "noindex";
  return "";
}

function withPreviewRobots(url, response) {
  const tag = robotsTagForHost(url.hostname);
  if (!tag) return response;
  const headers = new Headers(response.headers);
  if (!headers.has("x-robots-tag")) headers.set("x-robots-tag", tag);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function thanksPage(message, status) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${message} | Eating on 30A</title></head><body style="margin:0;background:#fbf7f1;color:#172421;font-family:Georgia,serif"><main style="max-width:36rem;margin:4rem auto;padding:0 1.25rem"><h1>${message}</h1><p><a href="/">Back to the guide</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function formError(html, error, status) {
  return html ? thanksPage(error, status) : json({ ok: false, error }, status);
}

async function readLimitedBody(request) {
  const type = request.headers.get("content-type") || "";
  const html = !type.includes("application/json");
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) return { html, tooLarge: true };
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return { html, unreadable: true };
  }
  if (raw.length > MAX_BODY) return { html, tooLarge: true };
  if (!html) {
    try {
      return { html, data: raw ? JSON.parse(raw) : null };
    } catch {
      return { html, badJson: true };
    }
  }
  const params = new URLSearchParams(raw);
  const data = {};
  for (const key of params.keys()) data[key] = params.get(key);
  return { html, data };
}

function blockedForm(request, loaded, tooLargeMessage, badJsonMessage) {
  if (loaded.tooLarge) return formError(loaded.html, tooLargeMessage, 413);
  if (loaded.unreadable || loaded.badJson) return formError(loaded.html, badJsonMessage, 400);
  if (rateLimited(clientIp(request))) {
    return formError(loaded.html, "Please wait a minute and try again.", 429);
  }
  return null;
}

export async function handleSubscribe(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const loaded = await readLimitedBody(request);
  const blocked = blockedForm(request, loaded, "That signup is too long.", "Send the signup as JSON.");
  if (blocked) return blocked;
  if (honeypotFilled(loaded.data)) {
    return loaded.html ? thanksPage("Thanks. We have your signup.", 200) : json({ ok: true, delivered: false, recorded: false }, 200);
  }
  const parsed = parseSubscribe(loaded.data);
  if (parsed.error) return formError(loaded.html, parsed.error, 400);
  const result = await deliverSubscribe(parsed.value, env, fetchImpl);
  if (!result.ok) return formError(loaded.html, result.error, 502);
  return loaded.html ? thanksPage("Thanks. We have your signup.", 200) : json(result, 200);
}

export async function handleListing(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const loaded = await readLimitedBody(request);
  const blocked = blockedForm(request, loaded, "That note is too long.", "Send the request as JSON.");
  if (blocked) return blocked;
  if (honeypotFilled(loaded.data)) {
    return loaded.html ? thanksPage("Thanks. We have your note.", 200) : json({ ok: true, delivered: false }, 200);
  }
  const parsed = parseListing(loaded.data);
  if (parsed.error) return formError(loaded.html, parsed.error, 400);
  const result = await deliverListing(parsed.value, env, fetchImpl);
  if (!result.ok) return formError(loaded.html, result.error, 502);
  return loaded.html ? thanksPage("Thanks. We have your note.", 200) : json(result, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const redirect = canonicalRedirect(url, request.method);
    if (redirect) return redirect;
    if (url.pathname === "/api/subscribe") return handleSubscribe(request, env);
    if (url.pathname === "/api/listing") return handleListing(request, env);
    return withPreviewRobots(url, await env.ASSETS.fetch(request));
  },
};
