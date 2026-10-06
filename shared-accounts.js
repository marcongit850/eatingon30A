/**
 * Server-side calls from a guide Worker to eating-accounts.
 * The browser never sees ACCOUNTS_SHARED_SECRET. Same request shape as account-api.js.
 */

const SESSION = "ea_session";

export function siteId(env) {
  const site = env && env.ACCOUNT_SITE;
  return site === "30a" || site === "destin" ? site : "";
}

export function readCookie(request, name = SESSION) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export async function accountsFetch(env, path, { method = "GET", body, session, ip, bytes } = {}) {
  const site = siteId(env);
  const secret = env && env.ACCOUNTS_SHARED_SECRET;
  if (!site || !secret) return null;
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${secret}`,
    "x-account-site": site,
  });
  if (session) headers.set("x-session", session);
  if (ip) headers.set("x-forwarded-for", ip);
  const init = { method, headers };
  if (bytes) {
    headers.set("content-type", "application/octet-stream");
    init.body = bytes;
  } else if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  if (env.ACCOUNTS && typeof env.ACCOUNTS.fetch === "function") {
    return env.ACCOUNTS.fetch(new Request(`https://eating-accounts${path}`, init));
  }
  const origin = String(env.ACCOUNTS_ORIGIN || "").replace(/\/$/, "");
  if (!origin) return null;
  return fetch(`${origin}${path}`, init);
}

export async function accountsJson(response) {
  if (!response) return { status: 503, body: { ok: false, error: "Sign-in is not set up yet." } };
  const type = response.headers.get("content-type") || "";
  if (!type.includes("json")) {
    const bytes = await response.arrayBuffer();
    return { status: response.status, body: null, bytes, contentType: type };
  }
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = { ok: false, error: "Sign-in is not set up yet." };
  }
  return { status: response.status, body };
}
