/**
 * Zoho Campaigns listsubscribe for coupon opt-ins.
 * Secrets stay on the Worker (wrangler secret put). None of them belong in
 * this file or in wrangler.jsonc:
 * ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
 * ZOHO_LIST_KEY_30A, ZOHO_LIST_KEY_DESTIN.
 * A missing client secret or list key skips the call. A token or list error
 * returns subscribed: false and does not throw, so Sheets and Resend can
 * still succeed.
 * site is the same label as the sheet row: 30A or Destin.
 */

const TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
const LISTSUBSCRIBE_URL = "https://campaigns.zoho.com/api/v1.1/json/listsubscribe";
const LIST_KEYS = {
  "30A": "ZOHO_LIST_KEY_30A",
  Destin: "ZOHO_LIST_KEY_DESTIN",
};

function zohoAuth(env) {
  const clientId = env && env.ZOHO_CLIENT_ID;
  const clientSecret = env && env.ZOHO_CLIENT_SECRET;
  const refreshToken = env && env.ZOHO_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function listKeyFor(env, site) {
  const name = LIST_KEYS[site];
  const listKey = name && env && env[name];
  return listKey || "";
}

async function readJson(response) {
  if (!response || typeof response.text !== "function") return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function refreshAccessToken(auth, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      refresh_token: auth.refreshToken,
    }).toString(),
  });
  const body = await readJson(response);
  if (!response || !response.ok) return "";
  const token = body && body.access_token;
  return token ? String(token) : "";
}

export async function subscribeZoho(env, { email, site, source } = {}, fetchImpl = fetch) {
  const auth = zohoAuth(env);
  const listKey = listKeyFor(env, site);
  if (!auth || !listKey || !email) return { subscribed: false };
  try {
    const accessToken = await refreshAccessToken(auth, fetchImpl);
    if (!accessToken) return { subscribed: false };
    const params = new URLSearchParams({
      resfmt: "JSON",
      listkey: listKey,
      contactinfo: JSON.stringify({ "Contact Email": email }),
    });
    if (source) params.set("source", source);
    const response = await fetchImpl(LISTSUBSCRIBE_URL, {
      method: "POST",
      headers: {
        authorization: `Zoho-oauthtoken ${accessToken}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    await readJson(response);
    return { subscribed: Boolean(response && response.ok) };
  } catch {
    return { subscribed: false };
  }
}
