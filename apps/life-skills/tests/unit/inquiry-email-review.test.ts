import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {AppError} from "../../src/lib/errors.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import {groupApplicationReviewHttp,type GroupApplicationReviewDependencies} from "../../src/features/group-application/review-http.ts";
import {inspectInquiryEmailSetup} from "../../src/features/group-application/inquiry-email-setup.ts";
import {INQUIRY_EMAIL_FROM} from "../../src/features/group-application/inquiry-email-copy.ts";

const origin="https://synthetic.example.invalid",token="s".repeat(43),path="/api/private/group-applications";
const practitioner={id:"00000000-0000-4000-8000-000000000010",workspaceId:"00000000-0000-4000-8000-000000000011",personId:"00000000-0000-4000-8000-000000000012",role:"practitioner",state:"active",locale:"en",sessionDigest:"synthetic",expiresAt:Date.now()+60000} as unknown as Actor;
const headers={host:"synthetic.example.invalid","x-forwarded-host":"synthetic.example.invalid","x-forwarded-proto":"https",cookie:`__Host-ls-session=${token}`};
function request(suffix="",init:RequestInit={}){return new Request(origin+path+suffix,{headers,...init});}
function setup(){
 const env={LS_INQUIRY_EMAIL_QUEUE_ENABLED:"true",LS_INQUIRY_EMAIL_SEND_ENABLED:"false",LS_AUTH_EMAIL_ENABLED:"true",LS_AUTH_EMAIL_PROVIDER:"gmail",LS_AUTH_EMAIL_FROM:INQUIRY_EMAIL_FROM,LS_AUTH_GOOGLE_CLIENT_ID:"SYNTHETIC_CLIENT_CANARY",LS_AUTH_GOOGLE_CLIENT_SECRET:"SYNTHETIC_SECRET_CANARY",LS_AUTH_GOOGLE_REFRESH_TOKEN:"SYNTHETIC_REFRESH_CANARY"};
 const report=inspectInquiryEmailSetup(env),list=vi.fn(async(actor:Actor)=>{void actor;return [];}),actor=vi.fn(async(token:string)=>{void token;return practitioner;}),emailSetup=vi.fn(()=>report),load=async()=>({origin,actor,store:{list},emailSetup});
 return {env,report,list,actor,emailSetup,load};
}
afterEach(()=>vi.restoreAllMocks());
describe("private inquiry email setup projection",()=>{
 it("returns only the fixed nonsecret report after authorized native listing",async()=>{
  const d=setup(),network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("NETWORK_FORBIDDEN"));
  const response=await groupApplicationReviewHttp(request(),d.load),body=await response.json();
  expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(body.data).toEqual({items:[],emailSetup:d.report});expect(body.data.emailSetup).toMatchObject({status:"SEND_DISABLED",queueEnabled:true,providerSetup:"CONFIGURED_UNVERIFIED",sendPermitted:false,senderVerified:false,deliveryVerified:false});
  expect(d.list).toHaveBeenCalledWith(practitioner);expect(d.emailSetup).toHaveBeenCalledTimes(1);expect(d.list.mock.invocationCallOrder[0]).toBeLessThan(d.emailSetup.mock.invocationCallOrder[0]!);
  const serialized=JSON.stringify(body);for(const value of [INQUIRY_EMAIL_FROM,d.env.LS_AUTH_GOOGLE_CLIENT_ID,d.env.LS_AUTH_GOOGLE_CLIENT_SECRET,d.env.LS_AUTH_GOOGLE_REFRESH_TOKEN])expect(serialized).not.toContain(value);
  expect(network).not.toHaveBeenCalled();
 });
 it("does not inspect setup while native workspace/fresh-actor authorization is pending",async()=>{
  const d=setup();let complete:(value:[])=>void=()=>{throw Error("NOT_STARTED");};
  d.list.mockImplementation(()=>new Promise<[]>(resolve=>{complete=resolve;}));
  const pending=groupApplicationReviewHttp(request(),d.load);await vi.waitFor(()=>expect(d.list).toHaveBeenCalledTimes(1));expect(d.emailSetup).not.toHaveBeenCalled();complete([]);
  expect((await pending).status).toBe(200);expect(d.emailSetup).toHaveBeenCalledTimes(1);
 });
 it.each(["FORBIDDEN","UNAUTHENTICATED","NOT_FOUND","UNAVAILABLE"] as const)("never inspects or returns setup when native listing refuses %s",async code=>{
  const d=setup();d.list.mockRejectedValue(new AppError(code));const response=await groupApplicationReviewHttp(request(),d.load),body=await response.json();
  expect(body.ok).toBe(false);expect(body).not.toHaveProperty("data");expect(d.emailSetup).not.toHaveBeenCalled();
 });
 it.each(["parent","child","adult_client"] as const)("denies %s before reading records or setup",async role=>{
  const d=setup(),load=async()=>({...await d.load(),actor:async()=>({...practitioner,role})});const response=await groupApplicationReviewHttp(request(),load);
  expect(response.status).toBe(403);expect(d.list).not.toHaveBeenCalled();expect(d.emailSetup).not.toHaveBeenCalled();
 });
 it.each([undefined,"__Host-ls-session=short",`__Host-ls-session=${token}; __Host-ls-session=${token}`])("denies absent/malformed/duplicate session cookies before inspection",async cookie=>{
  const d=setup(),h=new Headers(headers);if(cookie===undefined)h.delete("cookie");else h.set("cookie",cookie);
  expect((await groupApplicationReviewHttp(request("",{headers:h}),d.load)).status).toBe(401);expect(d.actor).not.toHaveBeenCalled();expect(d.list).not.toHaveBeenCalled();expect(d.emailSetup).not.toHaveBeenCalled();
 });
 it.each(["?emailSetup=true","?workspaceId=00000000-0000-4000-8000-000000000011"])("rejects client-selected setup/workspace query %s",async suffix=>{
  const d=setup();expect((await groupApplicationReviewHttp(request(suffix),d.load)).status).toBe(400);expect(d.actor).not.toHaveBeenCalled();expect(d.emailSetup).not.toHaveBeenCalled();
 });
 it("does not add a setup mutation endpoint",async()=>{
  const d=setup();expect((await groupApplicationReviewHttp(request("",{method:"POST"}),d.load)).status).toBe(400);expect(d.actor).not.toHaveBeenCalled();expect(d.emailSetup).not.toHaveBeenCalled();
 });
 it("uses explicit unavailable projection for a caller without a setup capability",async()=>{
  const d=setup(),load:()=>Promise<GroupApplicationReviewDependencies>=async()=>({origin,actor:d.actor,store:{list:d.list}});
  const response=await groupApplicationReviewHttp(request(),load);expect((await response.json()).data).toEqual({items:[],emailSetup:null});
 });
 it("returns a fixed failure rather than leaking callback errors or partial records",async()=>{
  const d=setup();d.emailSetup.mockImplementation(()=>{throw Error("SYNTHETIC_PRIVATE_CONFIG_ERROR");});
  const response=await groupApplicationReviewHttp(request(),d.load),body=await response.text();expect(response.status).toBe(503);expect(body).not.toContain("SYNTHETIC_PRIVATE_CONFIG_ERROR");expect(body).not.toContain("emailSetup");expect(body).not.toContain("items");
 });
 it("re-evaluates the server callback on each successful authorized read",async()=>{
  const d=setup();await groupApplicationReviewHttp(request(),d.load);d.emailSetup.mockReturnValue(inspectInquiryEmailSetup({}));
  const response=await groupApplicationReviewHttp(request(),d.load);expect((await response.json()).data.emailSetup).toMatchObject({queueEnabled:false,providerSetup:"INCOMPLETE",status:"SEND_DISABLED"});expect(d.emailSetup).toHaveBeenCalledTimes(2);
 });
});
