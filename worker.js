/**
 * Static assets are served by the assets binding.
 * /api/subscribe accepts a signup and, when the secrets exist, emails
 * CONTACT_EMAIL through Resend (https://resend.com). This is not a separate
 * newsletter product. Nothing is emailed until all three are set:
 * RESEND_API_KEY, SUBSCRIBE_FROM (a verified Resend sender), CONTACT_EMAIL.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseSubscribe(body) {
  if (!body || typeof body !== "object") return { error: "Send the signup as JSON." };
  const email = String(body.email || "").trim();
  if (!EMAIL.test(email) || email.length > 200) return { error: "Enter a valid email." };
  const audience = String(body.audience || "").trim().toLowerCase();
  if (audience && audience !== "local" && audience !== "visitor") return { error: "Choose Local or Visitor." };
  return { value: { email, audience, coupons: Boolean(body.coupons) } };
}

export async function deliverSubscribe(payload, env, fetchImpl = fetch) {
  const key = env && env.RESEND_API_KEY;
  const to = env && env.CONTACT_EMAIL;
  const from = env && env.SUBSCRIBE_FROM;
  if (!key || !to || !from) return { ok: true, delivered: false };
  const who = payload.audience === "local" ? "Local" : payload.audience === "visitor" ? "Visitor" : "Not specified";
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Eating on 30A coupon signup",
      text: `Email: ${payload.email}\nI am a: ${who}\nCoupons: ${payload.coupons ? "yes" : "no"}`,
    }),
  });
  if (!response.ok) return { ok: false, delivered: false, error: "The signup could not be sent." };
  return { ok: true, delivered: true };
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/subscribe") return handleSubscribe(request, env);
    return env.ASSETS.fetch(request);
  },
};
