/**
 * Same-origin account API for one guide.
 * Keep this file identical in eatingon30A and eatingindestin.
 * The browser talks only to this origin. This Worker calls the shared
 * eating-accounts Worker with ACCOUNTS_SHARED_SECRET.
 *
 * eatingon30a.com and eatingindestin.com do not share a parent domain.
 * This Worker sets ea_session for its own host only (HttpOnly, SameSite=Lax,
 * Secure on https, no Domain attribute). The accounts Worker holds ea_central
 * on its own host and hands this Worker a one-time code.
 *
 * Checked coupon boxes append a Google Sheet row after the accounts Worker
 * accepts the magic link. The body matches worker.js sheetPayload: token, site,
 * email, coupons, sourcePage, and no audience. 30A uses GOOGLE_SHEETS_WEBHOOK_TOKEN
 * and site 30A. Destin uses GOOGLE_SHEETS_WEBHOOK_TOKEN_DESTIN and site Destin.
 * Both boxes mean two posts. These writes do not send the Resend coupon signup
 * email. A missing Destin token, a missing webhook, or a sheet error does not
 * change the magic-link response.
 *
 * POST /api/account/coupons is the same sheet write for someone who is already
 * signed in. The email comes from the session. An email in the body is ignored.
 * sourcePage is the My places page. This route does not send a Resend coupon
 * email and does not send a magic link.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION = "ea_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const ACCOUNT_SOURCE_PAGES = {
  "30a": "https://www.eatingon30a.com/account/",
  destin: "https://www.eatingindestin.com/account/",
};
const PLACES_SOURCE_PAGES = {
  "30a": "https://www.eatingon30a.com/my-places/",
  destin: "https://www.eatingindestin.com/my-places/",
};
const COUPON_SHEETS = [
  { flag: "coupons30a", site: "30A", tokenKey: "GOOGLE_SHEETS_WEBHOOK_TOKEN" },
  { flag: "couponsDestin", site: "Destin", tokenKey: "GOOGLE_SHEETS_WEBHOOK_TOKEN_DESTIN" },
];

export function safeNext(value) {
  const text = String(value || "");
  if (!text) return "/my-places/";
  if (!text.startsWith("/") || text.startsWith("//") || text.startsWith("/api/")) return null;
  if (text.includes("\\") || text.includes("://") || /[\r\n]/.test(text)) return null;
  if (text.length > 300) return null;
  return text;
}

function json(body, status = 200, headers) {
  const out = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (headers) headers.forEach((value, key) => out.append(key, value));
  return new Response(JSON.stringify(body), { status, headers: out });
}

function redirect(location, setCookie) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

function secureRequest(request) {
  return new URL(request.url).protocol === "https:";
}

function sessionCookie(token, request, maxAge = SESSION_SECONDS) {
  const parts = [`${SESSION}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(request) {
  return sessionCookie("", request, 0);
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function siteId(env) {
  const site = env && env.ACCOUNT_SITE;
  return site === "30a" || site === "destin" ? site : "";
}

async function accountsFetch(env, path, { method = "GET", body, session, ip } = {}) {
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
  if (body !== undefined) headers.set("content-type", "application/json");
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (env.ACCOUNTS && typeof env.ACCOUNTS.fetch === "function") {
    return env.ACCOUNTS.fetch(new Request(`https://eating-accounts${path}`, init));
  }
  const origin = String(env.ACCOUNTS_ORIGIN || "").replace(/\/$/, "");
  if (!origin) return null;
  return fetch(`${origin}${path}`, init);
}

async function accountsJson(response) {
  if (!response) return { status: 503, body: { ok: false, error: "Sign-in is not set up yet." } };
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = { ok: false, error: "Sign-in is not set up yet." };
  }
  return { status: response.status, body };
}

function isChecked(value) {
  return value === true || value === "yes" || value === "on";
}

function couponChoice(body) {
  const coupons30a = isChecked(body.coupons30a);
  const couponsDestin = isChecked(body.couponsDestin);
  const marketingOptIn = coupons30a || couponsDestin || body.marketingOptIn === true || body.marketing === true || body.marketing === "yes";
  return { coupons30a, couponsDestin, marketingOptIn };
}

function accountSourcePage(env) {
  return ACCOUNT_SOURCE_PAGES[siteId(env)] || ACCOUNT_SOURCE_PAGES["30a"];
}

function placesSourcePage(env) {
  return PLACES_SOURCE_PAGES[siteId(env)] || PLACES_SOURCE_PAGES["30a"];
}

async function postCouponSheet(url, body, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response && typeof response.text === "function") await response.text();
  } catch {
    // A sheet miss must not fail the magic link.
  }
}

async function recordAccountCoupons(env, email, choice, fetchImpl, sourcePage) {
  const url = env && env.GOOGLE_SHEETS_WEBHOOK_URL;
  const page = sourcePage || accountSourcePage(env);
  const jobs = [];
  for (const item of COUPON_SHEETS) {
    if (!choice[item.flag]) continue;
    const token = env && env[item.tokenKey];
    if (!url || !token) continue;
    jobs.push(postCouponSheet(url, {
      token,
      site: item.site,
      email,
      coupons: true,
      sourcePage: page,
    }, fetchImpl));
  }
  await Promise.all(jobs);
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  try {
    if (type.includes("application/json")) {
      const body = await request.json();
      return body && typeof body === "object" ? body : {};
    }
    if (type.includes("form")) {
      const form = await request.formData();
      return {
        email: form.get("email"),
        marketing: form.get("marketing"),
        coupons30a: form.get("coupons30a"),
        couponsDestin: form.get("couponsDestin"),
        next: form.get("next"),
        slug: form.get("slug"),
        name: form.get("name"),
        area: form.get("area"),
        kind: form.get("kind"),
        site: form.get("site"),
        saved: form.get("saved"),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function handleAccount(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const path = url.pathname;
  const site = siteId(env);
  if (!site) return json({ ok: false, error: "Sign-in is not set up yet." }, 503);

  if (path === "/api/account/config" && request.method === "GET") {
    return json({
      ok: true,
      site,
      accountsOrigin: String(env.ACCOUNTS_ORIGIN || "").replace(/\/$/, ""),
    });
  }

  if (path === "/api/account/finish" && request.method === "GET") {
    const next = safeNext(url.searchParams.get("next"));
    if (!next) return redirect(new URL("/account/?need=1", url.origin).toString());
    if (url.searchParams.get("need") === "1") {
      const dest = new URL("/account/", url.origin);
      dest.searchParams.set("need", "1");
      if (next !== "/my-places/") dest.searchParams.set("next", next);
      return redirect(dest.toString());
    }
    const code = url.searchParams.get("code") || "";
    const result = await accountsJson(await accountsFetch(env, "/v1/exchange", {
      method: "POST",
      body: { code, site },
    }));
    if (!result.body || !result.body.token) {
      const dest = new URL("/account/", url.origin);
      dest.searchParams.set("need", "1");
      dest.searchParams.set("error", "expired");
      if (next !== "/my-places/") dest.searchParams.set("next", next);
      return redirect(dest.toString());
    }
    return redirect(new URL(next, url.origin).toString(), sessionCookie(result.body.token, request));
  }

  if (path === "/api/account/request" && request.method === "POST") {
    const body = await readBody(request);
    if (!body) return json({ ok: false, error: "Send the request as JSON." }, 400);
    const email = String(body.email || "").trim();
    if (!EMAIL.test(email) || email.length > 200) return json({ ok: false, error: "Enter a valid email." }, 400);
    const next = safeNext(body.next);
    if (!next) return json({ ok: false, error: "That return address is not allowed." }, 400);
    const returnTo = new URL("/api/account/finish", url.origin);
    returnTo.searchParams.set("next", next);
    const choice = couponChoice(body);
    const result = await accountsJson(await accountsFetch(env, "/v1/magic-link", {
      method: "POST",
      ip: request.headers.get("cf-connecting-ip") || "",
      body: {
        email,
        marketingOptIn: choice.marketingOptIn,
        site,
        returnTo: returnTo.toString(),
      },
    }));
    if (result.status < 400 && result.body && result.body.ok === true) {
      await recordAccountCoupons(env, email, choice, fetchImpl);
    }
    return json(result.body, result.status);
  }

  if (path === "/api/account/coupons" && request.method === "POST") {
    const body = await readBody(request);
    if (!body) return json({ ok: false, error: "Send the request as JSON." }, 400);
    const session = await accountsJson(await accountsFetch(env, "/v1/me", {
      session: readCookie(request, SESSION),
    }));
    const email = session.body && session.body.user && String(session.body.user.email || "").trim();
    if (!email || !EMAIL.test(email)) {
      if (session.status >= 400) {
        return json(session.body || { ok: false, error: "Sign in to save this." }, session.status);
      }
      return json({ ok: false, error: "Sign in to save this." }, 401);
    }
    const choice = couponChoice(body);
    if (!choice.coupons30a && !choice.couponsDestin) {
      return json({ ok: false, error: "Choose Eating on 30A, Eating in Destin, or both." }, 400);
    }
    await recordAccountCoupons(env, email, choice, fetchImpl, placesSourcePage(env));
    return json({ ok: true });
  }

  if (path === "/api/account/me" && request.method === "GET") {
    const result = await accountsJson(await accountsFetch(env, "/v1/me", {
      session: readCookie(request, SESSION),
    }));
    if (!result.body || result.status >= 400) return json(result.body || { ok: false, error: "Sign-in is not set up yet." }, result.status);
    if (result.body.user == null) return json({ ok: true, user: null });
    return json({ ok: true, user: result.body.user });
  }

  if (path === "/api/account/logout" && request.method === "POST") {
    await accountsFetch(env, "/v1/logout", {
      method: "POST",
      session: readCookie(request, SESSION),
      body: {},
    });
    return json({ ok: true }, 200, new Headers({ "set-cookie": clearCookie(request) }));
  }

  if (path === "/api/account/saves" && request.method === "GET") {
    const result = await accountsJson(await accountsFetch(env, "/v1/saves", {
      session: readCookie(request, SESSION),
    }));
    return json(result.body, result.status);
  }

  if (path === "/api/account/saves" && request.method === "PUT") {
    const body = await readBody(request);
    if (!body) return json({ ok: false, error: "Send the request as JSON." }, 400);
    const saved = body.saved === true || body.saved === "true";
    const targetSite = saved ? site : String(body.site || site);
    if (saved && body.site && body.site !== site) {
      return json({ ok: false, error: "Save this place on its own guide." }, 400);
    }
    const result = await accountsJson(await accountsFetch(env, "/v1/saves", {
      method: "PUT",
      session: readCookie(request, SESSION),
      body: {
        slug: body.slug,
        name: body.name,
        area: body.area,
        kind: body.kind,
        site: targetSite,
        saved,
      },
    }));
    return json(result.body, result.status);
  }

  return json({ ok: false, error: "Not found." }, 404);
}
