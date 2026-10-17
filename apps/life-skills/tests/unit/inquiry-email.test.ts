import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createInquiryEmailTransport,inquiryEmailQueueEnabled} from "../../src/features/group-application/inquiry-email.ts";
import {inquiryEmailContent} from "../../src/features/group-application/inquiry-email-copy.ts";
const reference="01234567-89ab-4def-8123-456789abcdef";
it.each(["en","he"] as const)("keeps %s acknowledgment minimal, with reference and no paid-enrollment claim",locale=>{
 const content=inquiryEmailContent(reference,locale);expect(content.text).toContain(reference);expect(content.subject.length).toBeLessThanOrEqual(150);
 expect(content.text).toContain(locale==="en"?"does not confirm enrollment, payment":"אינה אישור הרשמה, תשלום");expect(content.text).not.toContain("http");
});
it("rejects invalid references and keeps both queue and send OFF by default",()=>{
 expect(()=>inquiryEmailContent("header\r\ninjection","en")).toThrow();expect(inquiryEmailQueueEnabled({})).toBe(false);expect(inquiryEmailQueueEnabled({LS_INQUIRY_EMAIL_QUEUE_ENABLED:"true"})).toBe(true);
 expect(()=>createInquiryEmailTransport({})).toThrow();expect(()=>createInquiryEmailTransport({LS_INQUIRY_EMAIL_SEND_ENABLED:"true",LS_AUTH_EMAIL_PROVIDER:"resend"})).toThrow();
});
it("reuses the Office Gmail transport only under a separate explicit purpose gate; no credentials or external calls here",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:"synthetic_token"})).mockResolvedValueOnce(Response.json({id:"synthetic_receipt"}));
 const env={LS_INQUIRY_EMAIL_SEND_ENABLED:"true",LS_AUTH_EMAIL_ENABLED:"true",LS_AUTH_EMAIL_PROVIDER:"gmail",LS_AUTH_EMAIL_FROM:"office@bneineviimacademy.org",LS_AUTH_GOOGLE_CLIENT_ID:"synthetic-client",LS_AUTH_GOOGLE_CLIENT_SECRET:"synthetic-secret",LS_AUTH_GOOGLE_REFRESH_TOKEN:"synthetic-refresh"};
 const {transport,from}=createInquiryEmailTransport(env,fetcher);
 expect(transport.nonIdempotent).toBe(true);expect(await transport.send({from,to:"parent@example.invalid",...inquiryEmailContent(reference,"en"),idempotencyKey:`ls-auth-${reference}`})).toEqual({providerId:"synthetic_receipt"});expect(fetcher).toHaveBeenCalledTimes(2);
});
