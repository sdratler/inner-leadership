import {afterEach,expect,test,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
vi.mock("server-only",()=>({}));
import {normalizeWhatsAppRosterJson,projectProviderOnlyWhatsAppRoster,projectWhatsAppRoster,WHATSAPP_ROSTER_LIMITS,type WhatsAppRoster} from "../../../src/features/contact-ops/core/whatsapp-roster.ts";
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

test("retired roster transport remains unavailable with old credentials and performs no fetch",async()=>{
 vi.stubEnv("LIFE_SKILLS_CRM_BRIDGE_ORIGIN","https://academy.synthetic.invalid");vi.stubEnv("LIFE_SKILLS_APP_BRIDGE_SECRET","s".repeat(32));
 const fetchMock=vi.fn<typeof fetch>();vi.stubGlobal("fetch",fetchMock);
 await expect(crmBridgeWhatsAppRoster()).rejects.toMatchObject({code:"UNAVAILABLE"});
 expect(fetchMock).not.toHaveBeenCalled();
});

test("normalized roster strips provider-only fields and projects only one exact native match",()=>{
 const input={...source(),token:"PRIVATE",messages:["PRIVATE"],members:[{...(source().members as Record<string,unknown>[])[0],history:"PRIVATE"}]};
 const roster=normalizeWhatsAppRosterJson(JSON.stringify(input),binding,now);
 const result=projectWhatsAppRoster(roster,new Map([[phone,{state:"existing",people:[{personId,displayName:"Native Person",version:3,eligible:true}]}]]));
 expect(result.members[0]!.match).toEqual({state:"matched",personId,displayName:"Native Person"});expect(JSON.stringify(result)).not.toContain("PRIVATE");
 expect(result).toMatchObject({matchingScope:"native_crm_only",messagingPermission:"unknown",outboundEligible:false});
});

test("pre-cutover projection exposes no false People result or link identity",()=>{
 const roster=normalizeWhatsAppRosterJson(JSON.stringify(source([{memberId:"one",phone,displayName:"Synthetic Member",role:"member"},{memberId:"opaque@lid",phone:null,displayName:null,role:"unknown"}])),binding,now);
 const result=projectProviderOnlyWhatsAppRoster(roster);
 expect(result).toMatchObject({matchingScope:"provider_only_before_cutover",messagingPermission:"unknown",outboundEligible:false});
 expect(result.members.map(member=>member.match)).toEqual([{state:"unavailable",reason:"before_cutover"},{state:"unavailable",reason:"before_cutover"}]);
 expect(JSON.stringify(result)).not.toContain("personId");expect(JSON.stringify(result)).not.toContain("no_native_match");
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

test.each(["sheet_active","shadow_ready"] as const)("HTTP permits stable %s provider-only roster without a directory read",async phase=>{
 const order:string[]=[],directory={acquisitionMatches:vi.fn()},authority={read:vi.fn(async()=>{order.push("authority");return state(phase)})};
 const response=await whatsappRosterHttp(request(),async()=>({origin:"https://synthetic.invalid",now:()=>new Date(now),actor:async()=>{order.push("actor");return actor},binding,authority,bridge:async()=>{order.push("bridge");return JSON.stringify(source())},directory}));
 expect(response.status).toBe(200);expect(order).toEqual(["actor","authority","bridge","authority"]);expect(directory.acquisitionMatches).not.toHaveBeenCalled();
 expect((await response.json()).data).toMatchObject({matchingScope:"provider_only_before_cutover",members:[{match:{state:"unavailable",reason:"before_cutover"}}]});
});

test("HTTP fails closed for customer roles, held authority, native drift and hostile requests",async()=>{
 const bridge=vi.fn(async()=>JSON.stringify(source())),directory={acquisitionMatches:vi.fn(async()=>new Map([[phone,{state:"unmatched" as const,people:[]}]]))};
 const deps=(role:Actor["role"],phase:CutoverState["phase"],drift=false)=>async()=>({origin:"https://synthetic.invalid",now:()=>new Date(now),actor:async()=>({...actor,role}),binding,authority:{read:async()=>state(phase)},bridge,directory:drift?{acquisitionMatches:async()=>{throw new AppError("CONFLICT")}}:directory});
 expect((await whatsappRosterHttp(request(),deps("parent","native_active"))).status).toBe(403);expect(bridge).not.toHaveBeenCalled();
 for(const phase of ["frozen","rollback_prepared"] as const){expect((await whatsappRosterHttp(request(),deps("practitioner",phase))).status).toBe(409);expect(bridge).not.toHaveBeenCalled()}
 expect((await whatsappRosterHttp(request(),deps("practitioner","native_active",true))).status).toBe(409);expect(bridge).toHaveBeenCalledOnce();
 expect((await whatsappRosterHttp(request("/api/private/whatsapp-group-roster?group=other"),deps("practitioner","native_active"))).status).toBe(400);
});

test.each([{name:"epoch drift",error:null,status:409},{name:"expired session",error:new AppError("UNAUTHENTICATED"),status:401},{name:"revoked or demoted actor",error:new AppError("FORBIDDEN"),status:403}])("post-provider $name returns no roster",async({error,status})=>{
 const bridge=vi.fn(async()=>JSON.stringify(source())),directory={acquisitionMatches:vi.fn()},read=vi.fn();
 read.mockResolvedValueOnce(state("sheet_active"));
 if(error)read.mockRejectedValueOnce(error);else read.mockResolvedValueOnce({...state("shadow_ready"),epoch:4});
 const response=await whatsappRosterHttp(request(),async()=>({origin:"https://synthetic.invalid",now:()=>new Date(now),actor:async()=>actor,binding,authority:{read},bridge,directory}));
 expect(response.status).toBe(status);expect(bridge).toHaveBeenCalledOnce();expect(directory.acquisitionMatches).not.toHaveBeenCalled();expect((await response.json()).data).toBeUndefined();
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

test.each(["en","he"] as const)("%s pre-cutover UI states matching is unavailable and renders no People link",locale=>{
 const data=projectProviderOnlyWhatsAppRoster(normalizeWhatsAppRosterJson(JSON.stringify(source([{memberId:"one",phone,displayName:"Synthetic Member",role:"member"}])),binding,now));
 const html=renderToStaticMarkup(createElement(WhatsAppRosterWorkspace,{locale,initialData:data}));
 expect(html).toContain(locale==="he"?"ההתאמה לרשימת אנשים עדיין אינה זמינה":"People matching is not available yet");
 expect(html).not.toContain("personId=");expect(html).not.toContain(locale==="he"?"לא נמצא באנשים":"Not in People");
});
