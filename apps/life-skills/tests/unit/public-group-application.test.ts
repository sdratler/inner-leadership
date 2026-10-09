import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {beforeAll,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {groupApplicationNotice,groupApplicationFieldsSchema,normalizeGroupApplicationPhone} from "../../src/features/group-application/contract.ts";
import {issueGroupApplicationChallenge,verifyGroupApplicationChallenge} from "../../src/features/group-application/challenge.ts";
import {classifyPublicApplicationFailure,GroupApplicationForm} from "../../src/features/group-application/application-form.tsx";
import {GroupApplicationLanding} from "../../src/features/group-application/landing.tsx";
import {publicGroupApplicationHttp} from "../../src/features/group-application/http.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../src/features/group-application/candidate.ts";
import {groupApplicationReviewHttp} from "../../src/features/group-application/review-http.ts";
import {GroupApplicationReviewWorkspace} from "../../src/features/group-application/review-workspace.tsx";
import type {Actor} from "../../src/features/identity/types.ts";

const key="synthetic-public-group-application-rate-key-material",now=Date.parse("2029-01-01T12:00:03Z"),issued=now-3000;
const fields={parentName:"Synthetic Parent",parentPhone:"+15550002000",language:"en" as const,childAge:10,town:"Modiin",townChoice:"modiin" as const,neighborhood:"Synthetic neighborhood",
 schedulePreference:"evening" as const,observations:{intrinsicMotivation:"sometimes_difficult" as const},parentPriorities:"Synthetic practical priorities only.",
 permission:{confirmed:true as const,version:groupApplicationNotice.version,language:"en" as const}};
beforeAll(()=>expect(groupApplicationFieldsSchema.parse(fields)).toEqual(fields));
describe("public group application boundary",()=>{
 it("uses a signed, expiring challenge with a minimum completion interval",()=>{
  const token=issueGroupApplicationChallenge(key,issued,"00000000-0000-4000-8000-000000000001");
  expect(verifyGroupApplicationChallenge(token,key,now)).toMatchObject({v:1,issuedAt:issued,expiresAt:issued+1800000});
  expect(()=>verifyGroupApplicationChallenge(token,key,issued+1000)).toThrow("FORBIDDEN");
  expect(()=>verifyGroupApplicationChallenge(token.slice(0,-1)+"x",key,now)).toThrow("FORBIDDEN");
  expect(()=>verifyGroupApplicationChallenge(token,key,issued+1800001)).toThrow("FORBIDDEN");
 });
 it("stays default-off and permits only an explicit real release or synthetic loopback",()=>{
  expect(publicGroupApplicationEnvironmentEnabled({NODE_ENV:"production",LS_APP_ORIGIN:"https://app.example"})).toBe(false);
  expect(publicGroupApplicationEnvironmentEnabled({NODE_ENV:"production",LS_APP_ORIGIN:"https://app.example",LS_GROUP_APPLICATION_REAL_DATA_RELEASE:"true"})).toBe(true);
  expect(publicGroupApplicationEnvironmentEnabled({NODE_ENV:"development",LS_APP_ORIGIN:"http://127.0.0.1:3001",LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK:"true"})).toBe(true);
  expect(publicGroupApplicationEnvironmentEnabled({NODE_ENV:"development",LS_APP_ORIGIN:"https://public.example",LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK:"true"})).toBe(false);
 });
 it("accepts ordinary Israeli local phone formatting without changing the stored E.164 identity",()=>{
  expect(normalizeGroupApplicationPhone("052-000-2000")).toBe("+972520002000");
  expect(groupApplicationFieldsSchema.parse({...fields,parentPhone:"052 000 2000"}).parentPhone).toBe("+972520002000");
  expect(groupApplicationFieldsSchema.safeParse({...fields,childAge:0}).success).toBe(true);
  expect(groupApplicationFieldsSchema.safeParse({...fields,childAge:18}).success).toBe(false);
 });
 it("shows bilingual minimal fields, optional observations and non-enrollment consequences",()=>{
  for(const locale of ["en","he"] as const){const html=renderToStaticMarkup(createElement(GroupApplicationForm,{locale}));
   for(const name of ["parentName","parentPhone","childAge","townChoice","neighborhood","schedulePreference","screenAccess","screenTime","intrinsicMotivation","stressfulSituations","parentPriorities","permission","website"])expect(html).toContain(`name="${name}"`);
   expect(html).not.toContain('name="interestedInEveningGroup"');
   expect(html).toContain(locale==="he"?"אינן אבחון":"not an assessment");expect(html).toContain(locale==="he"?"אינה רושמת":"does not enroll");
  }
 });
 it("requires a neighborhood and a matching selected or other town while retaining legacy record read compatibility",()=>{
  expect(groupApplicationFieldsSchema.safeParse({...fields,neighborhood:""}).success).toBe(false);
  expect(groupApplicationFieldsSchema.safeParse({...fields,townChoice:"other",town:"Other place",otherTown:undefined}).success).toBe(false);
  expect(groupApplicationFieldsSchema.safeParse({...fields,townChoice:"other",town:"Other place",otherTown:"Other place"}).success).toBe(true);
  const legacy={...fields,town:"Synthetic town",townChoice:undefined,neighborhood:undefined,interestedInEveningGroup:true};
  expect(groupApplicationFieldsSchema.safeParse(legacy).success).toBe(true);
 });
 it("renders the approved bilingual landing structure with unchanged project and skill asset paths",()=>{
  const en=renderToStaticMarkup(createElement(GroupApplicationLanding,{locale:"en"}));
  const he=renderToStaticMarkup(createElement(GroupApplicationLanding,{locale:"he"}));
  expect(en).toContain("Apply to join a regular group");expect(en).toContain('lang="en"');expect(en).toContain('dir="ltr"');
  expect(he).toContain("הגשת בקשה להצטרפות לקבוצה קבועה");expect(he).toContain('lang="he"');expect(he).toContain('dir="rtl"');
  expect(new Set(en.match(/\/groups\/projects\/LS-PROJECT-[^\"?]+/g))).toHaveLength(9);
  expect(en.match(/\/groups\/private\/skill-/g)).toHaveLength(12);
  expect(en).toContain("one planned first group");expect(en).toContain("does not reserve a place");
  expect(en).toContain("meeting times to be confirmed");expect(en).not.toContain("90 minutes");expect(he).not.toContain("90 דקות");
 });
 it("renders a bilingual practitioner review destination with explicit separation",()=>{
  for(const locale of ["en","he"] as const){const html=renderToStaticMarkup(createElement(GroupApplicationReviewWorkspace,{locale}));
   expect(html).toContain(locale==="he"?"בקשות הצטרפות לקבוצה":"Group applications");
   expect(html).toContain(locale==="he"?"נשארות נפרדות":"remain separate");
  }
 });
 it("keeps application review practitioner-only, read-only and query-free",async()=>{
  const origin="https://synthetic.example.invalid",token="s".repeat(43),item={id:"00000000-0000-4000-8000-000000000004",source:"public_group_application" as const,state:"owner_review" as const,receivedAt:new Date(now).toISOString(),fields};
  const practitioner={id:"00000000-0000-4000-8000-000000000010",workspaceId:"00000000-0000-4000-8000-000000000011",personId:"00000000-0000-4000-8000-000000000012",role:"practitioner",state:"active",locale:"en",sessionDigest:"digest",expiresAt:now+60_000} as unknown as Actor;
  const list=vi.fn(async()=>[item]),actor=vi.fn(async()=>practitioner);
  const dependencies=async()=>({origin,actor,store:{list}}),headers={host:"synthetic.example.invalid","x-forwarded-host":"synthetic.example.invalid","x-forwarded-proto":"https",cookie:`__Host-ls-session=${token}`};
  const response=await groupApplicationReviewHttp(new Request(origin+"/api/private/group-applications",{headers}),dependencies);
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,data:{items:[item]}});expect(list).toHaveBeenCalledTimes(1);
  expect((await groupApplicationReviewHttp(new Request(origin+"/api/private/group-applications?state=owner_review",{headers}),dependencies)).status).toBe(400);
  expect((await groupApplicationReviewHttp(new Request(origin+"/api/private/group-applications",{method:"POST",headers}),dependencies)).status).toBe(400);
  const {cookie:unusedCookie,...anonymousHeaders}=headers;void unusedCookie;
  expect((await groupApplicationReviewHttp(new Request(origin+"/api/private/group-applications",{headers:anonymousHeaders}),dependencies)).status).toBe(401);
  const parentActor=async()=>({...await actor(),role:"parent" as const}) as Actor;
  const parentDependencies=async()=>({...await dependencies(),actor:parentActor});
  const parentDenied=await groupApplicationReviewHttp(new Request(origin+"/api/private/group-applications",{headers}),parentDependencies);
  expect(parentDenied.status).toBe(403);
 });
 it("distinguishes definite validation failures from unknown write outcomes",()=>{
  expect(classifyPublicApplicationFailure(false)).toBe("unavailable");
  expect(classifyPublicApplicationFailure(true,404)).toBe("unavailable");
  for(const status of [400,403,409,429])expect(classifyPublicApplicationFailure(true,status)).toBe("correctable");
  for(const status of [500,503,undefined])expect(classifyPublicApplicationFailure(true,status)).toBe("unconfirmed");
  for(const status of [400,403,409,429])expect(classifyPublicApplicationFailure(true,status,true)).toBe("correctable");
 });
 it("requires exact origin, same-origin fetch, empty honeypot and replays the same operation",async()=>{
  const origin="https://synthetic.example.invalid",challenge=issueGroupApplicationChallenge(key,issued,"00000000-0000-4000-8000-000000000002"),operationId="00000000-0000-4000-8000-000000000003";
  const submit=vi.fn(async()=>({saved:true as const,replayed:false,duplicate:false,item:{id:"00000000-0000-4000-8000-000000000004",source:"public_group_application" as const,state:"owner_review" as const,receivedAt:new Date(now).toISOString(),fields}})),consume=vi.fn(async(...args:[string,number])=>{void args;return {count:1,retryAfterMs:1000};});
  const dependencies=async()=>({enabled:true,environment:{NODE_ENV:"production",LS_APP_ORIGIN:origin,LS_IDENTITY_ENABLED:"true"},challengeKey:key,now:()=>now,limits:{consume},store:{submit}});
  const headers={host:"synthetic.example.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json"};
  const body=JSON.stringify({challenge,website:"",operationId,fields});
  const saved=await publicGroupApplicationHttp(new Request(origin+"/api/public/group-applications",{method:"POST",headers,body}),dependencies);
  expect(saved.status).toBe(201);expect(submit).toHaveBeenCalledWith({operationId,fields});expect(consume).toHaveBeenCalledWith(expect.any(String),60_000);
  const secondChallenge=issueGroupApplicationChallenge(key,issued,"00000000-0000-4000-8000-000000000005");
  const secondBody=JSON.stringify({challenge:secondChallenge,website:"",operationId:"00000000-0000-4000-8000-000000000006",fields});
  expect((await publicGroupApplicationHttp(new Request(origin+"/api/public/group-applications",{method:"POST",headers,body:secondBody}),dependencies)).status).toBe(201);
  expect(consume).toHaveBeenCalledTimes(2);expect(consume.mock.calls[0]![0]).toBe(consume.mock.calls[1]![0]);
  expect((await publicGroupApplicationHttp(new Request(origin+"/api/public/group-applications",{method:"POST",headers,body}),async()=>({...await dependencies(),limits:{consume:vi.fn(async()=>({count:31,retryAfterMs:1000}))}}))).status).toBe(429);
  expect((await publicGroupApplicationHttp(new Request(origin+"/api/public/group-applications",{method:"POST",headers:{...headers,origin:"https://attacker.invalid"},body}),dependencies)).status).toBe(403);
  expect((await publicGroupApplicationHttp(new Request(origin+"/api/public/group-applications",{method:"POST",headers:{...headers,"sec-fetch-site":"cross-site"},body}),dependencies)).status).toBe(403);
  expect((await publicGroupApplicationHttp(new Request(origin+"/api/public/group-applications",{method:"POST",headers,body:JSON.stringify({challenge,website:"filled",operationId,fields})}),dependencies)).status).toBe(400);
  expect((await publicGroupApplicationHttp(new Request(origin+"/api/public/group-applications",{headers:{host:"synthetic.example.invalid"}}),async()=>({...await dependencies(),enabled:false}))).status).toBe(404);
 });
});
