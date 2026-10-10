import {afterEach,expect,test,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
vi.mock("server-only",()=>({}));
import {normalizeWhatsAppRosterJson,projectWhatsAppRoster,WHATSAPP_ROSTER_LIMITS,type WhatsAppRoster} from "../../../src/features/contact-ops/core/whatsapp-roster.ts";
import {whatsappRosterHttp,WHATSAPP_ROSTER_GROUP_ID} from "../../../src/features/contact-ops/server/whatsapp-roster-http.ts";
import {WhatsAppRosterWorkspace} from "../../../src/features/contact-ops/whatsapp-roster-workspace.tsx";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {CutoverState} from "../../../src/features/contact-ops/core/cutover.ts";
import {AppError} from "../../../src/lib/errors.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {crmBridgeWhatsAppRoster} from "../../../src/features/prospects/bridge.ts";

const now="2026-10-11T10:00:00.000Z",phone="+12025550101",personId="00000000-0000-4000-8000-000000000001",token="a".repeat(43);
const binding=Object.freeze({channelId:"synthetic-life-skills-channel",groupId:WHATSAPP_ROSTER_GROUP_ID});
const actor={id:"00000000-0000-4000-8000-000000000010",workspaceId:"00000000-0000-4000-8000-000000000020",personId:"00000000-0000-4000-8000-000000000030",role:"practitioner",state:"active",locale:"en",sessionDigest:"synthetic",expiresAt:Date.now()+60000} as Actor;
const state=(phase:CutoverState["phase"]="native_active"):CutoverState=>({phase,epoch:3,batchId:"synthetic",sourceFileId:"synthetic",sourceRevision:"synthetic",nativeWritesSinceSwitch:0});
const source=(members:unknown[]=[{memberId:"12025550101",phone,displayName:"Synthetic Member",role:"member"}])=>({schemaVersion:1,channelId:binding.channelId,group:{id:binding.groupId,title:"Synthetic Group"},observedAt:now,actorRole:"unknown",completeness:{state:"complete",declaredCount:members.length,reason:null},members});
const request=(path="/api/private/whatsapp-group-roster",cookie=token)=>new Request("http://127.0.0.1:3000"+path,{headers:{cookie:`${SESSION_COOKIE}=${cookie}`,"x-forwarded-host":"synthetic.invalid","x-forwarded-proto":"https"}});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});

test("bridge transport uses only the fixed read route and rejects declared overflow",async()=>{
 vi.stubEnv("LIFE_SKILLS_CRM_BRIDGE_ORIGIN","https://academy.synthetic.invalid");vi.stubEnv("LIFE_SKILLS_APP_BRIDGE_SECRET","s".repeat(32));
 const fetchMock=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(source()),{status:200,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetchMock);
 await expect(crmBridgeWhatsAppRoster()).resolves.toContain(binding.groupId);
 expect(fetchMock).toHaveBeenCalledWith("https://academy.synthetic.invalid/api/bna/life-skills-app/whatsapp-group-roster",expect.objectContaining({method:"GET",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"}));
 expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({"X-Life-Skills-Bridge-Secret":"s".repeat(32)});
 fetchMock.mockResolvedValueOnce(new Response("{}",{status:200,headers:{"content-length":"65537"}}));
 await expect(crmBridgeWhatsAppRoster()).rejects.toThrow("crm_bridge_unavailable");
});

test("normalized roster strips provider-only fields and projects only one exact native match",()=>{
 const input={...source(),token:"PRIVATE",messages:["PRIVATE"],members:[{...(source().members as Record<string,unknown>[])[0],history:"PRIVATE"}]};
 const roster=normalizeWhatsAppRosterJson(JSON.stringify(input),binding,now);
 const result=projectWhatsAppRoster(roster,new Map([[phone,{state:"existing",people:[{personId,displayName:"Native Person",version:3,eligible:true}]}]]));
 expect(result.members[0]!.match).toEqual({state:"matched",personId,displayName:"Native Person"});expect(JSON.stringify(result)).not.toContain("PRIVATE");
 expect(result).toMatchObject({matchingScope:"native_crm_only",messagingPermission:"unknown",outboundEligible:false});
});

test("contract rejects bindings, overflow, duplicate identities and unsafe render text",()=>{
 const alternate={...source(),group:{id:"another@g.us",title:"Synthetic"}};expect(()=>normalizeWhatsAppRosterJson(JSON.stringify(alternate),binding,now)).toThrow(/BINDING_MISMATCH/);
 const members=Array.from({length:WHATSAPP_ROSTER_LIMITS.members+1},(_,index)=>({memberId:`synthetic-${index}`,phone:null,displayName:null,role:"unknown"}));
 expect(()=>normalizeWhatsAppRosterJson(JSON.stringify(source(members)),binding,now)).toThrow(/ROSTER_TOO_LARGE/);
 expect(()=>normalizeWhatsAppRosterJson(JSON.stringify(source([{memberId:"same",phone:null,displayName:null,role:"unknown"},{memberId:"same",phone:null,displayName:null,role:"member"}])),binding,now)).toThrow(/DUPLICATE_MEMBER/);
 expect(()=>normalizeWhatsAppRosterJson(JSON.stringify(source([{memberId:"one",phone:null,displayName:"<script>",role:"member"}])),binding,now)).toThrow(/INVALID_CONTRACT/);
});

test("shared phones and reserved claims disclose no candidate identity",()=>{
 const roster=normalizeWhatsAppRosterJson(JSON.stringify(source([{memberId:"one",phone,displayName:null,role:"member"},{memberId:"two",phone,displayName:null,role:"admin"}])),binding,now);
 const result=projectWhatsAppRoster(roster,new Map([[phone,{state:"reserved",people:[{personId,displayName:"PRIVATE_ACCOUNT",version:null,eligible:false}]}]]));
 expect(result.members.map(member=>member.match)).toEqual([{state:"ambiguous",reason:"duplicate_roster_phone"},{state:"ambiguous",reason:"duplicate_roster_phone"}]);expect(JSON.stringify(result)).not.toContain(personId);expect(JSON.stringify(result)).not.toContain("PRIVATE_ACCOUNT");
});

test("HTTP authorization and native authority precede the bridge; matching happens after it",async()=>{
 const order:string[]=[],directory={acquisitionMatches:vi.fn(async(_actor:Actor,phones:readonly string[],epoch:number)=>{order.push(`native:${epoch}`);expect(phones).toEqual([phone]);return new Map([[phone,{state:"unmatched" as const,people:[]}]]);})};
 const response=await whatsappRosterHttp(request(),async()=>({origin:"https://synthetic.invalid",now:()=>new Date(now),actor:async()=>{order.push("actor");return actor},binding,authority:{read:async()=>{order.push("authority");return state()}},bridge:async()=>{order.push("bridge");return JSON.stringify(source())},directory}));
 expect(response.status).toBe(200);expect(order).toEqual(["actor","authority","bridge","native:3"]);expect((await response.json()).data.members[0].match).toEqual({state:"unmatched",reason:"no_native_match"});
});

test("HTTP fails closed for customer roles, Sheet/frozen authority, drift and hostile requests",async()=>{
 const bridge=vi.fn(async()=>JSON.stringify(source())),directory={acquisitionMatches:vi.fn(async()=>new Map([[phone,{state:"unmatched" as const,people:[]}]]))};
 const deps=(role:Actor["role"],phase:CutoverState["phase"],drift=false)=>async()=>({origin:"https://synthetic.invalid",now:()=>new Date(now),actor:async()=>({...actor,role}),binding,authority:{read:async()=>state(phase)},bridge,directory:drift?{acquisitionMatches:async()=>{throw new AppError("CONFLICT")}}:directory});
 expect((await whatsappRosterHttp(request(),deps("parent","native_active"))).status).toBe(403);expect(bridge).not.toHaveBeenCalled();
 expect((await whatsappRosterHttp(request(),deps("practitioner","sheet_active"))).status).toBe(409);expect(bridge).not.toHaveBeenCalled();
 expect((await whatsappRosterHttp(request(),deps("practitioner","frozen"))).status).toBe(409);expect(bridge).not.toHaveBeenCalled();
 expect((await whatsappRosterHttp(request(),deps("practitioner","native_active",true))).status).toBe(409);expect(bridge).toHaveBeenCalledOnce();
 expect((await whatsappRosterHttp(request("/api/private/whatsapp-group-roster?group=other"),deps("practitioner","native_active"))).status).toBe(400);
});

test.each(["en","he"] as const)("%s roster UI is manual, read-only, responsive and links only exact matches",locale=>{
 const data:WhatsAppRoster=projectWhatsAppRoster(normalizeWhatsAppRosterJson(JSON.stringify(source([{memberId:"one",phone,displayName:"Synthetic Member",role:"admin"},{memberId:"opaque@lid",phone:null,displayName:null,role:"unknown"}])),binding,now),new Map([[phone,{state:"existing",people:[{personId,displayName:"Native Person",version:1,eligible:true}]}]]));
 const html=renderToStaticMarkup(createElement(WhatsAppRosterWorkspace,{locale,initialData:data}));
 expect(html).toContain(locale==="he"?"רענון הרשימה":"Refresh roster");expect(html).toContain("<table>");expect(html).toContain("lsu-native-cards");expect(html).toContain(`personId=${personId}`);
 expect(html).toContain(locale==="he"?"ללא שם":"Unnamed group member");expect(html).not.toContain("wa.me");expect(html).not.toContain("Send");expect(html).not.toContain("Invite");
});

test.each(["en","he"] as const)("%s partial empty snapshot never claims the group is empty",locale=>{
 const partial={...source([]),completeness:{state:"partial",declaredCount:null,reason:"unknown"}};
 const data:WhatsAppRoster=projectWhatsAppRoster(normalizeWhatsAppRosterJson(JSON.stringify(partial),binding,now),new Map());
 const html=renderToStaticMarkup(createElement(WhatsAppRosterWorkspace,{locale,initialData:data}));
 expect(html).toContain(locale==="he"?"תמונת המצב החלקית":"partial provider snapshot");
 expect(html).not.toContain(locale==="he"?"רשימה מלאה וריקה":"complete empty roster");
});
