import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks=vi.hoisted(()=>({process:vi.fn(),dispatch:vi.fn(),send:vi.fn()}));
vi.mock("../../src/providers/email/dispatch.ts",()=>({processResetRequest:mocks.process,dispatchOneAuthMail:mocks.dispatch}));
vi.mock("../../src/providers/email/gmail.ts",()=>({parseGmailAuthConfig:()=>({from:"office@bneineviimacademy.org"}),GmailAuthTransport:class{send=mocks.send;}}));
import { scheduleResetDelivery } from "../../src/providers/email/reset-delivery.ts";
const origin="https://life-skills.example.org",id="123e4567-e89b-12d3-a456-426614174000";
const rt={store:{},config:{origin},clock:{}} as Parameters<typeof scheduleResetDelivery>[2];
const env={LS_AUTH_EMAIL_ENABLED:"true",LS_AUTH_EMAIL_PROVIDER:"gmail"};
const response=()=>Response.json({ok:true,data:{accepted:true},requestId:id},{status:202});
const req=(path="reset/request",method="POST",locale="en")=>new Request(origin+"/api/identity/"+path,{method,headers:{"x-ls-locale":locale}});
beforeEach(()=>{vi.clearAllMocks();mocks.process.mockResolvedValue("outbox-id");mocks.dispatch.mockResolvedValue("sent");mocks.send.mockResolvedValue({providerId:"gmail-id"});});
describe("accepted-request-only Gmail reset delivery",()=>{
 test("does no provider or eligibility work before response and scopes exact request/outbox",async()=>{
  let callback:(()=>Promise<void>)|undefined;
  await scheduleResetDelivery(req(),response(),rt,env,cb=>{callback=cb;});
  expect(mocks.process).not.toHaveBeenCalled();expect(callback).toBeTypeOf("function");await callback!();
  expect(mocks.process).toHaveBeenCalledWith(rt.store,rt.config,rt.clock,id);
  expect(mocks.dispatch).toHaveBeenCalledWith(rt.store,rt.config,rt.clock,expect.objectContaining({nonIdempotent:true}),"office@bneineviimacademy.org","outbox-id");
 });
 test("never runs for other routes, rejected requests, disabled email or Resend selection",async()=>{
  const schedule=vi.fn();
  for(const request of [req("login"),req("reset/complete"),req("reset/request","GET")]) await scheduleResetDelivery(request,response(),rt,env,schedule);
  await scheduleResetDelivery(req(),new Response(null,{status:403}),rt,env,schedule);
  await scheduleResetDelivery(req(),response(),rt,{},schedule);
  await scheduleResetDelivery(req(),response(),rt,{...env,LS_AUTH_EMAIL_PROVIDER:"resend"},schedule);
  await scheduleResetDelivery(req(),Response.json({ok:true,data:{accepted:true},requestId:"attacker-input"},{status:202}),rt,env,schedule);
  expect(schedule).not.toHaveBeenCalled();
 });
 test("ineligible, duplicate or expired request sends nothing",async()=>{
  mocks.process.mockResolvedValue(null);let job:(()=>Promise<void>)|undefined;
  await scheduleResetDelivery(req(),response(),rt,env,cb=>{job=cb;});await job!();expect(mocks.dispatch).not.toHaveBeenCalled();
 });
 test.each(["en","he"])("%s reset points to existing locale client with fragment-only token",async locale=>{
  let job:(()=>Promise<void>)|undefined;await scheduleResetDelivery(req("reset/request","POST",locale),response(),rt,env,cb=>{job=cb;});await job!();
  const transport=mocks.dispatch.mock.calls[0]![3];
  await transport.send({from:"office@bneineviimacademy.org",to:"owner@example.org",subject:"old",text:origin+"/auth/reset#token="+"a".repeat(43),idempotencyKey:"ls-auth-"+id});
  const sent=mocks.send.mock.calls[0]![0];expect(sent.text).toContain(origin+"/"+locale+"/intake/staff?mode=reset#token=");expect(sent.to).toBe("owner@example.org");expect(sent.text).not.toContain("?token=");
  expect(sent.text).toContain(locale === "he" ? "15 דקות" : "15 minutes");expect(sent.text).toMatch(locale === "he" ? /6 תווים/ : /6 characters/);expect(sent.text).not.toMatch(locale === "he" ? /15 תווים/ : /15 characters/);
 });
 test("provider/store failures do not leak account, token or error details",async()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});mocks.process.mockRejectedValue(new Error("SECRET"));let job:(()=>Promise<void>)|undefined;
  await scheduleResetDelivery(req(),response(),rt,env,cb=>{job=cb;});await job!();expect(log).toHaveBeenCalledWith("AUTH_RESET_DELIVERY_FAILED");expect(log.mock.calls.flat().join()).not.toContain("SECRET");
 });
});
