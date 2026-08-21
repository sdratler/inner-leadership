const MAX_BODY_BYTES = 32_000;

const FIELD_ALLOWLIST = new Set([
  "form_type", "language", "page_url", "submitted_at",
  "parent_name", "second_parent_name", "email", "phone", "city",
  "preferred_language", "child_first_name", "child_age", "current_framework",
  "main_concerns", "desired_change", "strengths_interests", "current_support",
  "schedule_commitment", "parent_session_commitment", "privacy_consent", "consent",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "first_page", "last_page", "referrer"
]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(body)
  };
}

function sanitize(value, max = 5000) {
  if (typeof value !== "string") return value;
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

function selectWebhook(formType) {
  if (formType === "masterclass") return process.env.GHL_MASTERCLASS_WEBHOOK_URL;
  if (formType === "application") return process.env.GHL_APPLICATION_WEBHOOK_URL;
  return process.env.GHL_CONTACT_WEBHOOK_URL;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return json(413, { error: "Request is empty or too large" });
  }

  let incoming;
  try {
    incoming = JSON.parse(event.body);
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // Honeypot: silently accept bots without forwarding them.
  if (incoming.website) return json(200, { ok: true });

  const payload = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (FIELD_ALLOWLIST.has(key)) payload[key] = sanitize(value);
  }

  if (!payload.email || !payload.phone || !payload.parent_name) {
    return json(400, { error: "Missing required contact fields" });
  }
  if (!/^\S+@\S+\.\S+$/.test(String(payload.email))) {
    return json(400, { error: "Invalid email" });
  }

  payload.source_system = "inner_leadership_website";
  payload.user_agent = sanitize(event.headers["user-agent"] || "", 1000);
  payload.client_ip = sanitize(event.headers["x-nf-client-connection-ip"] || "", 100);

  const webhook = selectWebhook(payload.form_type);
  if (!webhook) {
    if (String(process.env.DEMO_MODE).toLowerCase() === "true") {
      console.log("DEMO_MODE lead", JSON.stringify({ ...payload, current_support: payload.current_support ? "[redacted]" : "" }));
      return json(200, { ok: true, demo: true });
    }
    console.error("Missing GHL webhook environment variable for", payload.form_type);
    return json(503, { error: "Form connection is not configured" });
  }

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("GHL webhook failed", response.status, detail.slice(0, 500));
      return json(502, { error: "CRM submission failed" });
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error("Lead forwarding error", error?.message || error);
    return json(502, { error: "CRM submission failed" });
  }
};
