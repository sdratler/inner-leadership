import type { IdentityStore } from "../../features/identity/store.ts";
import type { IdentityConfig } from "../../features/identity/config.ts";
import type { IdentityClock } from "../../features/identity/types.ts";
import { processResetRequest, dispatchOneAuthMail } from "./dispatch.ts";
import { GmailAuthTransport, parseGmailAuthConfig } from "./gmail.ts";

interface ResetRuntime { store: IdentityStore; config: IdentityConfig; clock: IdentityClock; }
type Schedule = (callback: () => Promise<void>) => void;
/** Only an already accepted, CSRF/rate-limited reset request can schedule its own mail.
 * No queue-wide drain, scheduler, recipient override, account creation, or fallback provider.
 * The response stays uniform; account eligibility and provider work happen after it is sent.
 */
export async function scheduleResetDelivery(request: Request, response: Response, runtime: ResetRuntime,
  env: Record<string, string | undefined>, schedule: Schedule): Promise<void> {
  if (env.LS_AUTH_EMAIL_ENABLED !== "true" || env.LS_AUTH_EMAIL_PROVIDER !== "gmail" ||
      request.method !== "POST" || new URL(request.url).pathname !== "/api/identity/reset/request" || response.status !== 202) return;
  const body = await response.clone().json();
  if (body?.ok !== true || body?.data?.accepted !== true || typeof body?.requestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) return;
  const requestId: string = body.requestId;
  // A bounded presentation preference, never used for identity, recipient or authorization.
  const locale = request.headers.get("x-ls-locale") === "he" ? "he" : "en";
  schedule(async () => {
    try {
      const config = parseGmailAuthConfig(env), provider = new GmailAuthTransport(config);
      const outboxId = await processResetRequest(runtime.store, runtime.config, runtime.clock, requestId);
      if (!outboxId) return;
      const transport = {
        nonIdempotent: true as const,
        send: async (message: Parameters<GmailAuthTransport["send"]>[0]) => {
          const line = message.text.split("\n").find(value => value.startsWith(runtime.config.origin + "/auth/reset#token="));
          if (!line) throw new Error("AUTH_RESET_LINK_INVALID");
          const link = new URL(line);
          if (link.origin !== runtime.config.origin || link.pathname !== "/auth/reset" || link.search ||
              !/^#token=[A-Za-z0-9_-]+$/.test(link.hash)) throw new Error("AUTH_RESET_LINK_INVALID");
          // The shared account entry supports practitioner, parent and adult-client accounts.
          link.pathname = `/${locale}/login`; link.search = "?mode=reset";
          const subject = locale === "he" ? "כישורי חיים — איפוס סיסמה" : "Life Skills — reset your password";
          const text = locale === "he"
            ? `התקבלה בקשה לאיפוס הסיסמה לחשבון כישורי חיים.\n\n${link.href}\n\nהקישור תקף ל־15 דקות. בחרו סיסמה חדשה בת 6 תווים לפחות. אין להעביר הודעה זו. אם לא ביקשתם איפוס, התעלמו ממנה.`
            : `You requested a password reset for your Life Skills account.\n\n${link.href}\n\nThis link expires in 15 minutes. Choose a new password of at least 6 characters, then sign in. Do not forward this email. If you did not request a reset, ignore it.`;
          return provider.send({ ...message, subject, text });
        }
      };
      const result = await dispatchOneAuthMail(runtime.store, runtime.config, runtime.clock, transport, config.from, outboxId);
      if (result === "failed" || result === "retry") console.error("AUTH_RESET_DELIVERY_FAILED");
    } catch { console.error("AUTH_RESET_DELIVERY_FAILED"); }
  });
}
