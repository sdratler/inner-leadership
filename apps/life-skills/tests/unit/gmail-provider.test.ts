import { describe, expect, test } from "vitest";
import { GmailAuthTransport, createAuthEmailTransport, parseGmailAuthConfig } from "../../src/providers/email/gmail.ts";
import { AuthEmailDeliveryError } from "../../src/providers/email/transport.ts";

const env = { LS_AUTH_EMAIL_ENABLED: "true", LS_AUTH_EMAIL_PROVIDER: "gmail", LS_AUTH_EMAIL_FROM: "office@bneineviimacademy.org", LS_AUTH_GOOGLE_CLIENT_ID: "client", LS_AUTH_GOOGLE_CLIENT_SECRET: "secret", LS_AUTH_GOOGLE_REFRESH_TOKEN: "refresh" };
const message = { from: env.LS_AUTH_EMAIL_FROM, to: "recipient@example.org", subject: "שלום / Reset", text: "שלום\nReset link", idempotencyKey: "ls-auth-123e4567-e89b-12d3-a456-426614174000" };
function fetcher(status = 200, body: unknown = { id: "gmail-message-1" }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return Response.json(body, { status }); }) as typeof fetch;
  return { calls, fetchMock };
}

describe("bounded Gmail auth transport", () => {
  test("requires explicit Gmail enablement and pinned Office sender", () => {
    expect(() => parseGmailAuthConfig({})).toThrow("UNAVAILABLE");
    expect(() => parseGmailAuthConfig({ ...env, LS_AUTH_EMAIL_FROM: "other@example.org" })).toThrow("UNAVAILABLE");
    expect(() => parseGmailAuthConfig({ ...env, LS_AUTH_GOOGLE_CLIENT_ID: "bad\nvalue" })).toThrow("UNAVAILABLE");
  });
  test("refreshes OAuth and sends exact single-recipient MIME without BCC or provider idempotency header", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return String(url).includes("oauth2") ? Response.json({ access_token: "access-token" }) : Response.json({ id: "gmail-message-1" });
    }) as typeof fetch;
    const result = await new GmailAuthTransport(parseGmailAuthConfig(env), fetchMock).send(message);
    expect(result).toEqual({ providerId: "gmail-message-1" }); expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token"); expect(calls[1]?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const headers = new Headers(calls[1]?.init?.headers); expect(headers.get("Authorization")).toBe("Bearer access-token"); expect(headers.has("Idempotency-Key")).toBe(false);
    const raw = JSON.parse(String(calls[1]?.init?.body)).raw as string; const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64").toString();
    expect(decoded).toContain("From: Life Skills <office@bneineviimacademy.org>\r\nTo: recipient@example.org"); expect(decoded).toContain("Message-ID: <ls-auth-123e4567-e89b-12d3-a456-426614174000@bneineviimacademy.org>"); expect(decoded).toContain("16nXnNeV150KUmVzZXQgbGluaw=="); expect(decoded).not.toMatch(/\r\n(Bcc|Cc):/i);
  });
  test("rejects injected headers and never calls provider", async () => {
    const f = fetcher(); const transport = new GmailAuthTransport(parseGmailAuthConfig(env), f.fetchMock);
    await expect(transport.send({ ...message, subject: "ok\r\nBcc: leak@example.org" })).rejects.toMatchObject({ retryable: false }); expect(f.calls).toHaveLength(0);
  });
  test("OAuth transient failure retries refresh, while Gmail 403/429/5xx/timeouts fail closed without resend", async () => {
    let refreshAttempts = 0; const f = (async (url: string | URL | Request) => { if (String(url).includes("oauth2")) { refreshAttempts++; return refreshAttempts === 1 ? new Response(null, { status: 503 }) : Response.json({ access_token: "token" }); } return Response.json({ id: "id" }); }) as typeof fetch;
    await new GmailAuthTransport(parseGmailAuthConfig(env), f).send(message); expect(refreshAttempts).toBe(2);
    for (const status of [403, 429, 500]) { const x = fetcher(status); await expect(new GmailAuthTransport(parseGmailAuthConfig(env), async (url, init) => String(url).includes("oauth2") ? Response.json({ access_token: "token" }) : x.fetchMock(url, init)).send(message)).rejects.toMatchObject({ retryable: false }); expect(x.calls).toHaveLength(1); }
    const timeout = new GmailAuthTransport(parseGmailAuthConfig(env), (async () => { throw new Error("timeout"); }) as typeof fetch); await expect(timeout.send(message)).rejects.toBeInstanceOf(AuthEmailDeliveryError);
  });
  test("provider factory has no implicit Resend fallback", () => { expect(() => createAuthEmailTransport({ ...env, LS_AUTH_EMAIL_PROVIDER: undefined })).toThrow("UNAVAILABLE"); expect(createAuthEmailTransport(env).from).toBe(env.LS_AUTH_EMAIL_FROM); });
  test("long Hebrew subjects fold into codepoint-safe RFC2047 words",async()=>{
    let raw="";const f=(async(url:string|URL|Request,init?:RequestInit)=>{if(String(url).includes("oauth2"))return Response.json({access_token:"token"});raw=Buffer.from(JSON.parse(String(init?.body)).raw,"base64url").toString();return Response.json({id:"id"});}) as typeof fetch;
    const subject="אבג😀".repeat(30);await new GmailAuthTransport(parseGmailAuthConfig(env),f).send({...message,subject});
    const encoded=raw.slice(raw.indexOf("Subject: ")+9,raw.indexOf("\r\nMIME-Version"));expect(encoded).toContain("\r\n ");
    const words=encoded.split("\r\n ");expect(words.every(w=>w.length<=75)).toBe(true);
    expect(words.map(w=>Buffer.from(w.slice(10,-2),"base64").toString()).join("")).toBe(subject);
  });
  test("permanent OAuth failure is not retried or sent",async()=>{
    let calls=0;const f=(async()=>{calls++;return Response.json({error:"invalid_grant"},{status:400});}) as typeof fetch;
    await expect(new GmailAuthTransport(parseGmailAuthConfig(env),f).send(message)).rejects.toMatchObject({retryable:false});expect(calls).toBe(1);
  });
});
