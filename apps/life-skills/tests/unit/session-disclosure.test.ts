import {afterEach,expect,test,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MAX_DISCLOSURE_RECORDS,disclosureInputSchema,disclosureSchema,disclosureRecordReadback,type DisclosureInput} from "../../src/features/session-workflow/disclosure-contract.ts";
import {disclosureRecordPort,disclosureRevokePort,disclosureUsePort,readDisclosures} from "../../src/features/session-workflow/disclosure-client.ts";
import {SessionDisclosurePanel} from "../../src/features/session-workflow/disclosure-panel.tsx";
import type {SessionDetail} from "../../src/features/session-workflow/database.ts";
vi.mock("../../src/features/identity/client.ts",()=>({sessionInfo:vi.fn(async()=>({csrfToken:"synthetic"}))}));
const scope={workspaceId:"00000000-0000-4000-8000-000000000001",caseId:"00000000-0000-4000-8000-000000000002",sessionId:"00000000-0000-4000-8000-000000000003"},id="00000000-0000-4000-8000-000000000004",signer="00000000-0000-4000-8000-000000000005",key="00000000-0000-4000-8000-000000000006";
const input:DisclosureInput={recipient:"DEMO — Specific person",purpose:"Synthetic agreed support",topic:"Specific agreed practice",authorityBasis:"Synthetic signed authority and restrictions",authorityState:"needs_review",channel:"phone",authorizedByAccountId:signer,childDiscussionRecorded:false,authorizedAt:"2026-09-01T10:00:00Z",expiresAt:"2026-10-03T10:00:00Z"},saved={...scope,...input,id,recordedByPractitionerId:signer,effective:false,usedAt:null,revokedAt:null};
const response=(data:unknown,status=200)=>new Response(JSON.stringify({ok:true,data}),{status,headers:{"content-type":"application/json"}});
afterEach(()=>vi.unstubAllGlobals());
test.each(["recipient","purpose","topic","authorityBasis"] as const)("local whitespace-only %s rejects before creating an attempt or sending, then corrected input uses the same key",async field=>{
 const fetch=vi.fn(async(_url:unknown,options?:RequestInit)=>options?.method==="POST"?response({disclosureId:id,usedAt:null,revokedAt:null},201):response([saved]));vi.stubGlobal("fetch",fetch);
 const port=disclosureRecordPort(scope);
 expect(await port.execute({...input,[field]:"   "},key)).toEqual({state:"rejected",message:"LOCAL_INVALID_REQUEST"});
 expect(fetch).not.toHaveBeenCalled();expect(await port.reconcile(key)).toEqual({state:"rejected",message:"INVALID_REQUEST"});expect(fetch).not.toHaveBeenCalled();
 expect(await port.execute(input,key)).toEqual({state:"accepted",value:saved});expect(fetch).toHaveBeenCalledTimes(2);
});
test("a remote rejection remains distinct from local validation and is not reported as an unsent change",async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({error:{code:"INVALID_REQUEST"}}),{status:400,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetch);
 expect(await disclosureRecordPort(scope).execute(input,key)).toEqual({state:"rejected",message:"INVALID_REQUEST"});expect(fetch).toHaveBeenCalledTimes(1);
});
test("the shared 100-record envelope accepts its boundary and rejects overflow without truncation",async()=>{
 expect(MAX_DISCLOSURE_RECORDS).toBe(100);
 const rows=Array.from({length:MAX_DISCLOSURE_RECORDS},(_,index)=>({...saved,id:`00000000-0000-4000-8000-${String(index+100).padStart(12,"0")}`}));
 vi.stubGlobal("fetch",vi.fn(async()=>response(rows)));expect(await readDisclosures(scope)).toEqual(rows);
 vi.stubGlobal("fetch",vi.fn(async()=>response([...rows,{...saved,id}])));await expect(readDisclosures(scope)).rejects.toThrow("UNAVAILABLE");
});
test("strict scoped record rejects missing evidence, impossible time, extra/private fields and wrong projected scope",async()=>{
 expect(disclosureSchema.parse(saved)).toEqual(saved);expect(disclosureRecordReadback(saved,input)).toBe(true);
 for(const change of [{recipient:" "},{authorityBasis:""},{authorizedAt:"2026-02-30T10:00:00Z"},{channel:"whatsapp"},{clinicalNotes:"not accepted"}])expect(disclosureInputSchema.safeParse({...input,...change}).success).toBe(false);
 for(const change of [{recipient:"other"},{purpose:"other"},{authorityState:"checked"},{usedAt:"2026-09-02T10:00:00Z"}])expect(disclosureRecordReadback({...saved,...change} as typeof saved,input)).toBe(false);
 for(const raw of [[{...saved,caseId:id}],[{...saved,effective:"true"}],[saved,saved],[{...saved,transcript:"never"}]]){vi.stubGlobal("fetch",vi.fn(async()=>response(raw)));await expect(readDisclosures(scope)).rejects.toThrow("UNAVAILABLE");}
});
test("a committed record and lost read retries GET only, with stable caller input and actual readback before Saved",async()=>{
 const calls:{method:string;body:string|undefined}[]=[],body=structuredClone(input);let reads=0;
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,options?:RequestInit)=>{calls.push({method:options?.method??"GET",body:options?.body as string|undefined});if(options?.method==="POST")return response({disclosureId:id,usedAt:null,revokedAt:null},201);if(++reads===1)throw Error("Synthetic receipt loss");return response([saved]);}));
 const port=disclosureRecordPort(scope);expect(await port.execute(body,key)).toEqual({state:"unknown"});body.recipient="mutated caller input";expect(await port.reconcile(key)).toEqual({state:"accepted",value:saved});expect(calls.map(c=>c.method)).toEqual(["POST","GET","GET"]);expect(JSON.parse(calls[0]!.body!).recipient).toBe(input.recipient);
});
test("a lost write response retries the identical key/body and malformed readback cannot become Saved",async()=>{
 const posts:RequestInit[]=[],port=disclosureRecordPort(scope);let reads=0;
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,options?:RequestInit)=>{if(options?.method==="POST"){posts.push(options);if(posts.length===1)throw Error("Synthetic committed-write response lost");return response({disclosureId:id,usedAt:null,revokedAt:null},201);}return response([{...saved,recipient:++reads===1?"wrong readback":saved.recipient}]);}));
 expect(await port.execute(input,key)).toEqual({state:"unknown"});expect(await port.reconcile(key)).toEqual({state:"unknown"});expect(await port.reconcile(key)).toEqual({state:"accepted",value:saved});expect(posts).toHaveLength(2);expect(posts[0]!.body).toBe(posts[1]!.body);expect(posts[0]!.headers).toEqual(posts[1]!.headers);
});
test.each([401,403,404,409,503])("actual HTTP %s cannot become a saved disclosure",async status=>{
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({error:{code:status===409?"CONFLICT":"UNAVAILABLE"}}),{status})));const result=await disclosureRecordPort(scope).execute(input,key);expect(result.state).not.toBe("accepted");
});
test("actual use and revocation require exact protected status readback; no locally invented date",async()=>{
 const usedAt="2026-09-02T10:00:00.000Z",revokedAt="2026-09-03T10:00:00.000Z";let kind="use";
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,options?:RequestInit)=>options?.method==="POST"?response({disclosureId:id,usedAt,revokedAt:kind==="use"?null:revokedAt},201):response([{...saved,usedAt,revokedAt:kind==="use"?null:revokedAt}])));
 expect(await disclosureUsePort(scope,id).execute({usedAt},key)).toEqual({state:"accepted",value:{...saved,usedAt}});kind="revoke";expect(await disclosureRevokePort(scope,id).execute({expectedUsedAt:usedAt},key)).toEqual({state:"accepted",value:{...saved,usedAt,revokedAt}});
});
test.each(["en","he"] as const)("%s retained panel starts collapsed, unchecked, with no automatic signature or clinical unlock",locale=>{
 const model={...scope,consentSigners:[{accountId:signer,name:"DEMO Parent"}]} as SessionDetail,html=renderToStaticMarkup(createElement(SessionDisclosurePanel,{locale,model}));expect(html).toContain(locale==="en"?"Scoped disclosure records":"תיעוד מסירת מידע מוגדרת");expect(html).not.toMatch(/<details[^>]* open/);expect(html).not.toMatch(/checked=""/);expect(html).toContain('value="needs_review"');expect(html).toContain(locale==="en"?"not a blanket waiver":"אינו ויתור גורף");expect(html).toContain('step="1"');expect(html).not.toContain('role="alert"');
});
test.each(["en","he"] as const)("%s scoped authority and channel expose exact names without option-text contamination",locale=>{
 const model={...scope,consentSigners:[{accountId:signer,name:"DEMO Parent"}]} as SessionDetail,html=renderToStaticMarkup(createElement(SessionDisclosurePanel,{locale,model}));
 expect(html).toContain(`aria-label="${locale==="en"?"Authority status":"מצב הסמכות"}"`);expect(html).toContain(`aria-label="${locale==="en"?"Authorized communication channel":"ערוץ התקשורת שהותר"}"`);
});
