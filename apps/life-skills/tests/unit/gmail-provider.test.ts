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

describe("reviewed Academy HTML transport alternative", () => {
  const capture = () => {
    const raw: string[] = []; let calls=0;
    const mock=(async(url:string|URL|Request,init?:RequestInit)=>{
      calls++;
      if(String(url).includes("oauth2")) return Response.json({access_token:"synthetic-token"});
      raw.push(Buffer.from(JSON.parse(String(init?.body)).raw,"base64url").toString("utf8"));
      return Response.json({id:"synthetic-receipt"});
    }) as typeof fetch;
    return {raw,mock,calls:()=>calls};
  };
  test("legacy plaintext MIME remains byte-for-byte unchanged",async()=>{
    const c=capture(); await new GmailAuthTransport(parseGmailAuthConfig(env),c.mock).send({...message,subject:"Receipt",text:"plain\nbody"});
    expect(c.raw[0]).toBe([
      "From: Life Skills <office@bneineviimacademy.org>","To: recipient@example.org","Subject: =?UTF-8?B?UmVjZWlwdA==?=",
      "MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64",
      "Message-ID: <ls-auth-123e4567-e89b-12d3-a456-426614174000@bneineviimacademy.org>","","cGxhaW4KYm9keQ==",""
    ].join("\r\n"));
  });
  test.each(["en","he"])("preserves both exact %s bodies with inert preheader and one recipient",async(locale)=>{
    const c=capture(),text=locale==="he"?"שלום\nאישור עניין":"Hello\nConfirm interest";
    const html=`<!doctype html><html lang="${locale}"><body><div style="display:none">${text}</div><p>Safe &amp; exact</p></body></html>`;
    await new GmailAuthTransport(parseGmailAuthConfig(env),c.mock,"JLFA Office").send({...message,text,html});
    const raw=c.raw[0]!; expect(c.calls()).toBe(2);expect(c.raw).toHaveLength(1);
    expect(raw).toContain("From: JLFA Office <office@bneineviimacademy.org>");
    const boundary=`jlfa-alt-${message.idempotencyKey}`;
    const parts=raw.split(`--${boundary}`);expect(parts).toHaveLength(4);
    expect(parts[1]).toContain("Content-Type: text/plain; charset=UTF-8");expect(parts[2]).toContain("Content-Type: text/html; charset=UTF-8");
    expect(Buffer.from(parts[1]!.split("\r\n\r\n")[1]!.trim(),"base64").toString()).toBe(text);
    expect(Buffer.from(parts[2]!.split("\r\n\r\n")[1]!.trim(),"base64").toString()).toBe(html);
    expect(raw).not.toMatch(/\r\n(?:Cc|Bcc|Preview|X-Preview):/i);expect(raw.match(/\r\nTo:/g)).toHaveLength(1);
  });
  test("rejects malformed or oversized HTML and non-Academy display before credential or provider access",async()=>{
    const c=capture(),t=new GmailAuthTransport(parseGmailAuthConfig(env),c.mock,"JLFA Office");
    for(const html of ["","א".repeat(16385),null,7]) await expect(t.send({...message,html} as Parameters<typeof t.send>[0])).rejects.toMatchObject({retryable:false});
    await expect(new GmailAuthTransport(parseGmailAuthConfig(env),c.mock).send({...message,html:"<p>body</p>"})).rejects.toMatchObject({retryable:false});
    expect(c.calls()).toBe(0);
  });
  test("Resend cannot silently discard an exact HTML alternative",async()=>{
    const {ResendAuthTransport}=await import("../../src/providers/email/resend.ts");const c=capture();
    const t=new ResendAuthTransport({enabled:true,from:message.from,apiKey:"synthetic"},c.mock);
    await expect(t.send({...message,html:"<p>body</p>"})).rejects.toMatchObject({retryable:false});expect(c.calls()).toBe(0);
  });
  test("uncertain HTML send has one provider attempt and no automatic retry",async()=>{
    let sends=0;const mock=(async(url:string|URL|Request)=>{if(String(url).includes("oauth2"))return Response.json({access_token:"synthetic"});sends++;throw new Error("synthetic transport uncertainty");}) as typeof fetch;
    const t=new GmailAuthTransport(parseGmailAuthConfig(env),mock,"JLFA Office");expect(t.nonIdempotent).toBe(true);
    await expect(t.send({...message,html:"<p>body</p>"})).rejects.toMatchObject({retryable:false});expect(sends).toBe(1);
  });
});
