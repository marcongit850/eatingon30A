/**
 * Static assets are served by the assets binding.
 * /api/subscribe accepts a coupon signup and /api/listing accepts a restaurant
 * correction, edit, deletion, new listing, or other note. A restaurant name
 * is optional. /api/list-restaurant accepts the full listing form. When the
 * secrets exist, each one emails CONTACT_EMAIL through Resend (https://resend.com).
 * Nothing is emailed until all three are set: RESEND_API_KEY, SUBSCRIBE_FROM
 * (a verified Resend sender), CONTACT_EMAIL.
 * The full listing form keeps a honeypot field and a per-isolate rate limit.
 * A coupon signup is also appended through an Apps Script webhook when both
 * GOOGLE_SHEETS_WEBHOOK_URL and GOOGLE_SHEETS_WEBHOOK_TOKEN are set. `delivered`
 * is only the Resend result. `recorded` is true only when that webhook returns
 * JSON with ok: true. An HTTP 200 HTML error page, any other non-JSON body,
 * and {ok:false} stay recorded: false. A Sheets miss does not fail the signup
 * when Resend accepted it.
 * sourcePage is the live homepage. site.config.json origin stays the workers.dev preview.
 */

import listingOptions from "./data/listing-form.json" with { type: "json" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIST_WINDOW_MS = 10 * 60 * 1000;
const LIST_MAX = 5;
const listHits = new Map();
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

const ROLE_LABELS = new Map(listingOptions.roles.map((item) => [item.value, item.label]));
const INTENT_LABELS = new Map(listingOptions.intents.map((item) => [item.value, item.label]));
const AREA_SET = new Set(listingOptions.areas);
const CUISINE_SET = new Set(listingOptions.cuisines);
const FOOD_SET = new Set(listingOptions.foods);
const MEAL_SET = new Set(listingOptions.meals);
const PRICE_SET = new Set(listingOptions.prices);

function scalar(value) {
  if (Array.isArray(value)) return value.length ? value[0] : "";
  return value;
}

function isYes(value) {
  return value === true || value === "yes" || value === "true" || value === "on";
}

function cleanLine(value, max) {
  const text = String(scalar(value) ?? "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  return { text, tooLong: text.length > max };
}

function cleanBlock(value, max) {
  const text = String(scalar(value) ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return { text, tooLong: text.length > max };
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function optionalLink(value, max, message) {
  const text = String(scalar(value) ?? "").replace(/[\u0000-\u001F\u007F]+/g, "").trim();
  if (!text) return { text: "" };
  if (/\s/.test(text) || text.length > max) return { error: message };
  return { text };
}

function pickList(value, allowed, emptyError, unknownError) {
  const items = [];
  const seen = new Set();
  const raw = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  for (const item of raw) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    if (!allowed.has(text)) return { error: unknownError };
    seen.add(text);
    items.push(text);
    if (items.length > 40) return { error: unknownError };
  }
  if (emptyError && items.length === 0) return { error: emptyError };
  return { items };
}

export function resetListRestaurantLimits() {
  listHits.clear();
}

export function clientAddress(request) {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 80);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 80) || "unknown";
  return "unknown";
}

export function limitListRestaurant(ip, now = Date.now()) {
  const cutoff = now - LIST_WINDOW_MS;
  if (listHits.size > 5000) {
    for (const [key, times] of listHits) {
      const fresh = times.filter((stamp) => stamp > cutoff);
      if (fresh.length === 0) listHits.delete(key);
      else listHits.set(key, fresh);
    }
  }
  const recent = (listHits.get(ip) || []).filter((stamp) => stamp > cutoff);
  if (recent.length >= LIST_MAX) {
    listHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  listHits.set(ip, recent);
  return false;
}

export function honeypotTripped(body) {
  return String(scalar(body && body.eo30a_hp) ?? "").trim().length > 0;
}

export function parseListRestaurant(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send the request as JSON." };
  const name = cleanLine(body.name, 120);
  if (name.tooLong) return { error: "Keep your name under 120 characters." };
  if (!name.text) return { error: "Enter your name." };
  const role = String(scalar(body.role) || "").trim();
  if (!ROLE_LABELS.has(role)) return { error: "Choose your role." };
  const email = String(scalar(body.email) || "").trim();
  if (!EMAIL.test(email) || email.length > 200) return { error: "Enter a valid email." };
  const contactPhone = cleanLine(body.contactPhone, 40);
  if (contactPhone.tooLong || (contactPhone.text && phoneDigits(contactPhone.text).length < 7)) {
    return { error: "Enter a valid phone number." };
  }
  const bestTime = cleanLine(body.bestTime, 120);
  if (bestTime.tooLong) return { error: "Keep the best time under 120 characters." };
  const intent = String(scalar(body.intent) || "").trim();
  if (!INTENT_LABELS.has(intent)) return { error: "Choose new listing or an update." };
  const existingListing = cleanLine(body.existingListing, 300);
  if (existingListing.tooLong) return { error: "Keep the current listing under 300 characters." };
  if (intent === "update" && !existingListing.text) {
    return { error: "Add the current listing URL or the exact restaurant name." };
  }
  const restaurant = cleanLine(body.restaurant, 160);
  if (restaurant.tooLong) return { error: "Keep the restaurant name under 160 characters." };
  if (!restaurant.text) return { error: "Enter a restaurant name." };
  const area = cleanLine(body.area, 120);
  if (!area.text || !AREA_SET.has(area.text)) return { error: "Choose an area." };
  const address = cleanLine(body.address, 240);
  if (address.tooLong) return { error: "Keep the street address under 240 characters." };
  if (!address.text) return { error: "Enter the street address." };
  const restaurantPhone = cleanLine(body.restaurantPhone, 40);
  if (restaurantPhone.tooLong || !restaurantPhone.text || phoneDigits(restaurantPhone.text).length < 7) {
    return { error: "Enter the restaurant phone number." };
  }
  const website = optionalLink(body.website, 300, "Check the website link.");
  if (website.error) return { error: website.error };
  const price = String(scalar(body.price) || "").trim();
  if (!PRICE_SET.has(price)) return { error: "Choose a price range." };
  const description = cleanBlock(body.description, 2000);
  if (description.tooLong) return { error: "Keep the description under 2,000 characters." };
  if (!description.text) return { error: "Add a short description." };
  const hours = [];
  for (const day of listingOptions.days) {
    const closed = isYes(scalar(body[day.closed]));
    const text = cleanLine(body[day.hours], 80);
    if (text.tooLong) return { error: `Keep ${day.label} hours under 80 characters.` };
    if (!closed && !text.text) return { error: `Add hours for ${day.label}, or mark it closed.` };
    hours.push({ label: day.label, value: closed ? "Closed" : text.text });
  }
  const seasonalNote = cleanBlock(body.seasonalNote, 500);
  if (seasonalNote.tooLong) return { error: "Keep the seasonal note under 500 characters." };
  const cuisines = pickList(body.cuisines, CUISINE_SET, "Choose at least one cuisine type.", "Choose cuisine types from the list.");
  if (cuisines.error) return { error: cuisines.error };
  const meals = pickList(body.meals, MEAL_SET, "Choose at least one meal.", "Choose meals from the list.");
  if (meals.error) return { error: meals.error };
  const foods = pickList(body.foods, FOOD_SET, "", "Choose food styles from the list.");
  if (foods.error) return { error: foods.error };
  const amenities = listingOptions.amenities.map((item) => ({
    label: String(item.label).replace(/\*$/, ""),
    value: isYes(scalar(body[item.name])) ? "Yes" : "No",
  }));
  const facebook = optionalLink(body.facebook, 300, "Check the Facebook link.");
  if (facebook.error) return { error: facebook.error };
  const instagram = optionalLink(body.instagram, 300, "Check the Instagram link.");
  if (instagram.error) return { error: instagram.error };
  const logoUrl = optionalLink(body.logoUrl, 300, "Check the logo link.");
  if (logoUrl.error) return { error: logoUrl.error };
  const listPhotoUrl = optionalLink(body.listPhotoUrl, 300, "Check the list photo link.");
  if (listPhotoUrl.error) return { error: listPhotoUrl.error };
  const detailPhotoUrl = optionalLink(body.detailPhotoUrl, 300, "Check the detail photo link.");
  if (detailPhotoUrl.error) return { error: detailPhotoUrl.error };
  const videoUrl = optionalLink(body.videoUrl, 300, "Check the video link.");
  if (videoUrl.error) return { error: videoUrl.error };
  const notes = cleanBlock(body.notes, 4000);
  if (notes.tooLong) return { error: "Keep the notes under 4,000 characters." };
  if (!isYes(scalar(body.authorized))) return { error: "Confirm you are authorized to submit for this restaurant." };
  return {
    value: {
      name: name.text,
      role,
      roleLabel: ROLE_LABELS.get(role),
      email,
      contactPhone: contactPhone.text,
      bestTime: bestTime.text,
      intent,
      intentLabel: INTENT_LABELS.get(intent),
      existingListing: existingListing.text,
      restaurant: restaurant.text,
      area: area.text,
      address: address.text,
      restaurantPhone: restaurantPhone.text,
      website: website.text,
      price,
      description: description.text,
      hours,
      seasonalNote: seasonalNote.text,
      cuisines: cuisines.items,
      meals: meals.items,
      foods: foods.items,
      amenities,
      facebook: facebook.text,
      instagram: instagram.text,
      logoUrl: logoUrl.text,
      listPhotoUrl: listPhotoUrl.text,
      detailPhotoUrl: detailPhotoUrl.text,
      videoUrl: videoUrl.text,
      notes: notes.text,
      authorized: true,
    },
  };
}

function labeled(label, value) {
  const text = String(value || "").trim();
  return `${label}: ${text || "Not provided"}`;
}

export function formatListRestaurant(payload) {
  const lines = [
    "About you",
    labeled("Your name", payload.name),
    labeled("Role", payload.roleLabel),
    labeled("Email", payload.email),
    labeled("Phone", payload.contactPhone),
    labeled("Best time to reach you", payload.bestTime),
    "",
    "What is this for?",
    labeled("Request", payload.intentLabel),
    labeled("Current listing", payload.existingListing),
    "",
    "Basics",
    labeled("Restaurant name", payload.restaurant),
    labeled("Area", payload.area),
    labeled("Street address", payload.address),
    labeled("Phone", payload.restaurantPhone),
    labeled("Website", payload.website),
    labeled("Price range", payload.price),
    "Short description:",
    payload.description || "Not provided",
    "",
    "Hours",
  ];
  for (const day of payload.hours) lines.push(labeled(day.label, day.value));
  lines.push(labeled("Seasonal note", payload.seasonalNote));
  lines.push(
    "",
    "What they serve",
    labeled("Cuisine types", payload.cuisines.join(", ")),
    labeled("Meals", payload.meals.join(", ")),
    labeled("Food style", payload.foods.join(", ")),
    "",
    "Amenities",
  );
  for (const item of payload.amenities) lines.push(labeled(item.label, item.value));
  lines.push(
    "",
    "Social and media",
    labeled("Facebook URL", payload.facebook),
    labeled("Instagram", payload.instagram),
    labeled("Logo URL", payload.logoUrl),
    labeled("List photo URL", payload.listPhotoUrl),
    labeled("Detail photo URL", payload.detailPhotoUrl),
    labeled("Video URL", payload.videoUrl),
    "",
    "Anything else",
    "Notes:",
    payload.notes || "Not provided",
    labeled("Authorized to submit", payload.authorized ? "Yes" : "No"),
  );
  return lines.join("\n");
}

export async function deliverListRestaurant(payload, env, fetchImpl = fetch) {
  return postResend(
    env,
    {
      reply_to: payload.email,
      subject: `Eating on 30A restaurant form: ${payload.intentLabel}, ${payload.restaurant}`,
      text: formatListRestaurant(payload),
    },
    fetchImpl,
    "The request could not be sent.",
  );
}

function formList(form, name) {
  if (typeof form.getAll === "function") return form.getAll(name);
  const value = form.get(name);
  return value == null ? [] : [value];
}

function listRestaurantFromForm(form) {
  const body = {
    eo30a_hp: form.get("eo30a_hp"),
    name: form.get("name"),
    role: form.get("role"),
    email: form.get("email"),
    contactPhone: form.get("contactPhone"),
    bestTime: form.get("bestTime"),
    intent: form.get("intent"),
    existingListing: form.get("existingListing"),
    restaurant: form.get("restaurant"),
    area: form.get("area"),
    address: form.get("address"),
    restaurantPhone: form.get("restaurantPhone"),
    website: form.get("website"),
    price: form.get("price"),
    description: form.get("description"),
    seasonalNote: form.get("seasonalNote"),
    cuisines: formList(form, "cuisines"),
    meals: formList(form, "meals"),
    foods: formList(form, "foods"),
    facebook: form.get("facebook"),
    instagram: form.get("instagram"),
    logoUrl: form.get("logoUrl"),
    listPhotoUrl: form.get("listPhotoUrl"),
    detailPhotoUrl: form.get("detailPhotoUrl"),
    videoUrl: form.get("videoUrl"),
    notes: form.get("notes"),
    authorized: form.get("authorized"),
  };
  for (const day of listingOptions.days) {
    body[day.hours] = form.get(day.hours);
    body[day.closed] = form.get(day.closed);
  }
  for (const item of listingOptions.amenities) body[item.name] = form.get(item.name);
  return body;
}

async function readListRestaurantBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      return { html: false, body: await request.json() };
    } catch {
      return { html: false, error: "Send the request as JSON." };
    }
  }
  const form = await request.formData();
  return { html: true, body: listRestaurantFromForm(form) };
}

export async function handleListRestaurant(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  if (limitListRestaurant(clientAddress(request))) {
    const error = "Please wait a few minutes and try again.";
    const html = !(request.headers.get("content-type") || "").includes("application/json");
    return html ? thanksPage(error, 429) : json({ ok: false, error }, 429);
  }
  const read = await readListRestaurantBody(request);
  const html = read.html;
  if (read.error) return html ? thanksPage(read.error, 400) : json({ ok: false, error: read.error }, 400);
  if (honeypotTripped(read.body)) {
    return html ? thanksPage("Thanks. We have your listing.", 200) : json({ ok: true, delivered: false }, 200);
  }
  const parsed = parseListRestaurant(read.body);
  if (parsed.error) return html ? thanksPage(parsed.error, 400) : json({ ok: false, error: parsed.error }, 400);
  const result = await deliverListRestaurant(parsed.value, env, fetchImpl);
  if (!result.ok) return html ? thanksPage(result.error, 502) : json(result, 502);
  return html ? thanksPage("Thanks. We have your listing.", 200) : json(result, 200);
}

const CANONICAL_HOST = "www.eatingon30a.com";

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

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      return { html: false, parsed: parseSubscribe(await request.json()) };
    } catch {
      return { html: false, parsed: { error: "Send the signup as JSON." } };
    }
  }
  const form = await request.formData();
  return {
    html: true,
    parsed: parseSubscribe({
      email: form.get("email"),
      audience: form.get("audience"),
      coupons: form.get("coupons") === "yes",
    }),
  };
}

export async function handleSubscribe(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const { html, parsed } = await readBody(request);
  if (parsed.error) {
    return html ? thanksPage(parsed.error, 400) : json({ ok: false, error: parsed.error }, 400);
  }
  const result = await deliverSubscribe(parsed.value, env, fetchImpl);
  if (!result.ok) {
    return html ? thanksPage(result.error, 502) : json(result, 502);
  }
  return html ? thanksPage("Thanks. We have your signup.", 200) : json(result, 200);
}

async function readListingBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      return { html: false, parsed: parseListing(await request.json()) };
    } catch {
      return { html: false, parsed: { error: "Send the request as JSON." } };
    }
  }
  const form = await request.formData();
  return {
    html: true,
    parsed: parseListing({
      restaurant: form.get("restaurant"),
      town: form.get("town"),
      type: form.get("type"),
      details: form.get("details"),
      name: form.get("name"),
      email: form.get("email"),
    }),
  };
}

export async function handleListing(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const { html, parsed } = await readListingBody(request);
  if (parsed.error) {
    return html ? thanksPage(parsed.error, 400) : json({ ok: false, error: parsed.error }, 400);
  }
  const result = await deliverListing(parsed.value, env, fetchImpl);
  if (!result.ok) {
    return html ? thanksPage(result.error, 502) : json(result, 502);
  }
  return html ? thanksPage("Thanks. We have your note.", 200) : json(result, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const redirect = canonicalRedirect(url, request.method);
    if (redirect) return redirect;
    if (url.pathname === "/api/subscribe") return handleSubscribe(request, env);
    if (url.pathname === "/api/listing") return handleListing(request, env);
    if (url.pathname === "/api/list-restaurant") return handleListRestaurant(request, env);
    return withPreviewRobots(url, await env.ASSETS.fetch(request));
  },
};
