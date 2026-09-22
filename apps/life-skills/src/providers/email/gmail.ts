import { AppError } from "../../lib/errors.ts";
import type { AuthEmailMessage, AuthEmailTransport } from "./transport.ts";
import { AuthEmailDeliveryError } from "./transport.ts";
import { parseResendAuthConfig, ResendAuthTransport } from "./resend.ts";

const OFFICE_FROM = "office@bneineviimacademy.org";
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const TOKEN = /^[^\r\n]{1,4096}$/;
const KEY = /^ls-auth-[0-9a-f-]{36}$/;
const MAX_SUBJECT = 150;
const MAX_TEXT = 5000;

export interface GmailAuthConfig {
  enabled: true;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  from: typeof OFFICE_FROM;
}

function validSecret(value: string | undefined, max = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\r\n]/.test(value);
}

export function parseGmailAuthConfig(env: Record<string, string | undefined>): GmailAuthConfig {
  if (env.LS_AUTH_EMAIL_ENABLED !== "true" || env.LS_AUTH_EMAIL_PROVIDER !== "gmail" ||
      !validSecret(env.LS_AUTH_GOOGLE_CLIENT_ID, 512) || !validSecret(env.LS_AUTH_GOOGLE_CLIENT_SECRET, 512) ||
      !validSecret(env.LS_AUTH_GOOGLE_REFRESH_TOKEN, 4096) || env.LS_AUTH_EMAIL_FROM !== OFFICE_FROM) {
    throw new AppError("UNAVAILABLE");
  }
  return { enabled: true, clientId: env.LS_AUTH_GOOGLE_CLIENT_ID, clientSecret: env.LS_AUTH_GOOGLE_CLIENT_SECRET,
    refreshToken: env.LS_AUTH_GOOGLE_REFRESH_TOKEN, from: OFFICE_FROM };
}

function headerValue(value: string, max: number): boolean {
  return value.length <= max && !/[\r\n]/.test(value);
}
function encodedWord(value: string): string {
  const chunks: number[][] = [[]];
  for (const character of value) {
    const bytes = [...Buffer.from(character, "utf8")];
    const current = chunks[chunks.length - 1]!;
    if (current.length && current.length + bytes.length > 45) chunks.push([]);
    chunks[chunks.length - 1]!.push(...bytes);
  }
  const words = chunks.map(chunk => `=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`);
  return words.join("\r\n ");
}
function base64url(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
}
function mime(message: AuthEmailMessage): string {
  const messageId = `<${message.idempotencyKey}@bneineviimacademy.org>`;
  return [
    `From: Life Skills <${OFFICE_FROM}>`, `To: ${message.to}`, `Subject: ${encodedWord(message.subject)}`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64",
    `Message-ID: ${messageId}`, "", base64(Buffer.from(message.text, "utf8")), ""
  ].join("\r\n");
}

export class GmailAuthTransport implements AuthEmailTransport {
  readonly nonIdempotent = true;
  constructor(private readonly config: GmailAuthConfig, private readonly sendFetch: typeof fetch = fetch) {}

  private async accessToken(): Promise<string> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.sendFetch("https://oauth2.googleapis.com/token", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
            refresh_token: this.config.refreshToken, grant_type: "refresh_token" }).toString()
        });
        if (!response.ok) { try { await response.body?.cancel(); } catch { /* response cleanup is best effort */ } if (response.status < 500 && response.status !== 429) throw new AuthEmailDeliveryError(false); throw new Error("retry"); }
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || typeof (data as { access_token?: unknown }).access_token !== "string" ||
            !TOKEN.test((data as { access_token: string }).access_token)) throw new Error();
        return (data as { access_token: string }).access_token;
      } catch (error) { last = error; if (error instanceof AuthEmailDeliveryError) throw error; if (attempt === 0) continue; }
    }
    void last;
    throw new AuthEmailDeliveryError(true);
  }

  async send(message: AuthEmailMessage): Promise<{ providerId: string }> {
    if (!this.config.enabled || message.from !== OFFICE_FROM || !ADDRESS.test(message.to) || message.to.length > 254 ||
        !KEY.test(message.idempotencyKey) || !headerValue(message.subject, MAX_SUBJECT) ||
        message.text.length > MAX_TEXT) throw new AuthEmailDeliveryError(false);
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.sendFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: base64url(mime(message)) })
      });
    } catch { throw new AuthEmailDeliveryError(false); }
    if (!response.ok) { try { await response.body?.cancel(); } catch { /* response cleanup is best effort */ } throw new AuthEmailDeliveryError(false); }
    try {
      const data: unknown = await response.json();
      const id = data && typeof data === "object" ? (data as { id?: unknown }).id : undefined;
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new Error();
      return { providerId: id };
    } catch { throw new AuthEmailDeliveryError(false); }
  }
}

export function createAuthEmailTransport(env: Record<string, string | undefined>, sendFetch: typeof fetch = fetch): { transport: AuthEmailTransport; from: string } {
  if (env.LS_AUTH_EMAIL_PROVIDER === "gmail") { const config = parseGmailAuthConfig(env); return { transport: new GmailAuthTransport(config, sendFetch), from: config.from }; }
  if (env.LS_AUTH_EMAIL_PROVIDER === "resend") { const config = parseResendAuthConfig(env); return { transport: new ResendAuthTransport(config, sendFetch), from: config.from }; }
  throw new AppError("UNAVAILABLE");
}
