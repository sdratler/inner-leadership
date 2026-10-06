import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {GoogleContactsClient,googleContactsConfig,GOOGLE_LEAD_GROUP} from "../../../src/features/contact-ops/server/google-contacts.ts";
const config={clientId:"synthetic-client",clientSecret:"synthetic-secret",refreshToken:"synthetic-owner-refresh",
 ownerEmail:"owner@example.invalid",ownerSubject:"123456789012345678901"};
const contacts="https://www.googleapis.com/auth/contacts",email="https://www.googleapis.com/auth/userinfo.email",phone="+15550002001",group="contactGroups/syntheticLead";
const person=(resource="people/synthetic1",groups=["contactGroups/unrelated"])=>({resourceName:resource,etag:"synthetic-v1",names:[{displayName:"Preserved synthetic normal name"}],
 phoneNumbers:[{value:phone}],memberships:groups.map(contactGroupResourceName=>({contactGroupMembership:{contactGroupResourceName}}))});
const groupValue=(members:string[]=[],etag="synthetic-g1")=>({resourceName:group,etag,name:GOOGLE_LEAD_GROUP,groupType:"USER_CONTACT_GROUP",memberCount:members.length,memberResourceNames:members});
const json=(body:unknown,status=200)=>Response.json(body,{status});
function fixture(handler:(path:string,init:RequestInit)=>Response|Promise<Response>,grantScope=contacts+" "+email,owner:unknown={id:config.ownerSubject,email:config.ownerEmail,verified_email:true}){
 const calls:{url:URL;init:RequestInit}[]=[];
 const fetcher=vi.fn(async(url:RequestInfo|URL,init:RequestInit={})=>{const u=new URL(String(url));calls.push({url:u,init});
  if(u.hostname==="oauth2.googleapis.com")return json({access_token:"synthetic-access",scope:grantScope,expires_in:3600});
  if(u.hostname==="www.googleapis.com")return json(owner);
  expect(u.hostname).toBe("people.googleapis.com");return handler(u.pathname+u.search,init);
 }) as unknown as typeof fetch;
 return {client:new GoogleContactsClient(config,fetcher),calls};
}
test("Contacts default OFF and missing dedicated grant never borrow Office refresh authority",()=>{
 expect(googleContactsConfig({LS_AUTH_GOOGLE_REFRESH_TOKEN:"synthetic-office"})).toBeNull();
 expect(()=>googleContactsConfig({LS_CONTACTS_GOOGLE_ENABLED:"true",LS_AUTH_GOOGLE_REFRESH_TOKEN:"synthetic-office"})).toThrow("GOOGLE_CONTACTS_UNAVAILABLE");
 expect(googleContactsConfig({LS_CONTACTS_GOOGLE_ENABLED:"true",LS_AUTH_GOOGLE_CLIENT_ID:config.clientId,LS_AUTH_GOOGLE_CLIENT_SECRET:config.clientSecret,
  LS_CONTACTS_GOOGLE_REFRESH_TOKEN:config.refreshToken,LS_CONTACTS_GOOGLE_OWNER_EMAIL:config.ownerEmail,LS_CONTACTS_GOOGLE_OWNER_SUBJECT:config.ownerSubject})).toEqual(config);
});
test.each([contacts,email,"https://www.googleapis.com/auth/contacts.readonly "+email])("missing minimum write/account scope denies before People API: %s",scope=>{
 const f=fixture(()=>{throw Error("NO_PEOPLE_CALL_ALLOWED");},scope);return expect(f.client.readPerson("people/synthetic1")).rejects.toThrow("GOOGLE_CONTACTS_PERMISSION");
});
test.each([{id:"different",email:config.ownerEmail,verified_email:true},{id:config.ownerSubject,email:"office@example.invalid",verified_email:true},
 {id:config.ownerSubject,email:config.ownerEmail,verified_email:false}])("wrong/unverified owner fails before contact access",async owner=>{
 const f=fixture(()=>{throw Error("NO_PEOPLE_CALL_ALLOWED");},contacts+" "+email,owner);await expect(f.client.readPerson("people/synthetic1")).rejects.toThrow("GOOGLE_CONTACTS_");
 expect(f.calls.filter(c=>c.url.hostname==="people.googleapis.com")).toHaveLength(0);
});
test("bounded exact-group read returns only group members/administrative fields; no clinical/address-book request",async()=>{
 const ids=["people/synthetic1","people/synthetic2"],f=fixture(path=>path.includes("people:batchGet")?
  json({responses:ids.map(id=>({requestedResourceName:id,person:{...person(id,[group]),biographies:[{value:"Synthetic excluded clinical field"}]},status:{}}))}):json(groupValue(ids)));
 const r=await f.client.readLeadGroup(group);expect(r.contacts).toHaveLength(2);expect(JSON.stringify(r)).not.toContain("clinical");
 const batch=f.calls.find(c=>c.url.pathname.endsWith("people:batchGet"))!;expect(batch.url.searchParams.getAll("resourceNames")).toEqual(ids);
 expect(batch.url.searchParams.get("personFields")).toBe("names,phoneNumbers,memberships");expect(f.calls.some(c=>/connections|otherContacts/.test(c.url.pathname))).toBe(false);
});
test.each(["oversized","incomplete","duplicate","changed","wrong-group","missing-membership","wrong-resource"])("unsafe group snapshot %s never returns a partial import",async mode=>{
 let reads=0;const ids=["people/synthetic1"],f=fixture(path=>{
  if(path.includes("people:batchGet"))return json({responses:[{requestedResourceName:ids[0],person:person(mode==="wrong-resource"?"people/wrong":ids[0],mode==="missing-membership"?[]:[group])}]});
  reads++;return json({...groupValue(mode==="duplicate"?[...ids,...ids]:ids,mode==="changed"&&reads>1?"changed":"synthetic-g1"),
   ...(mode==="oversized"?{memberCount:201}:mode==="incomplete"?{memberCount:2}:mode==="wrong-group"?{name:"Life Skills Leads"}:{} )});
 });await expect(f.client.readLeadGroup(group)).rejects.toThrow("GOOGLE_CONTACTS_");expect(f.calls.every(c=>!c.init.method||c.init.method==="POST"&&c.url.hostname==="oauth2.googleapis.com")).toBe(true);
});
test("exact label write is sequential, preserves normal name/other memberships and verifies idempotent replay",async()=>{
 let applied=false;const f=fixture((path,init)=>{if(path.includes("members:modify")){expect(JSON.parse(String(init.body))).toEqual({resourceNamesToAdd:["people/synthetic1"]});applied=true;return json({});}
  return path.startsWith("/v1/contactGroups/")?json(groupValue()):json(person("people/synthetic1",applied?["contactGroups/unrelated",group]:["contactGroups/unrelated"]));});
 expect(await f.client.labelExisting(group,"people/synthetic1",phone)).toMatchObject({state:"applied",replayed:false});
 expect(await f.client.labelExisting(group,"people/synthetic1",phone)).toMatchObject({state:"applied",replayed:true});
 expect(f.calls.filter(c=>c.url.pathname.includes("members:modify"))).toHaveLength(1);expect(f.calls.some(c=>/createContact|updateContact/.test(c.url.pathname))).toBe(false);
 for(const call of f.calls){expect(call.init.redirect).toBe("error");expect(call.init.cache).toBe("no-store");expect(call.init.signal).toBeInstanceOf(AbortSignal);}
});
test.each(["wrong-phone","name-changed","label-missing","other-label-lost","not-found","system-group"])("label does not claim applied after %s",async mode=>{
 let mutated=false;const f=fixture((path,init)=>{
  if(path.includes("members:modify")){mutated=true;expect(init.method).toBe("POST");return json(mode==="not-found"?{notFoundResourceNames:["people/synthetic1"]}:{});}
  if(path.startsWith("/v1/contactGroups/"))return json({...groupValue(),...(mode==="system-group"?{groupType:"SYSTEM_CONTACT_GROUP"}:{})});
  return json({...person("people/synthetic1",mutated?mode==="label-missing"?["contactGroups/unrelated"]:mode==="other-label-lost"?[group]:["contactGroups/unrelated",group]:["contactGroups/unrelated"]),
   ...(mode==="wrong-phone"?{phoneNumbers:[{value:"+15550002002"}]}:mutated&&mode==="name-changed"?{names:[{displayName:"Concurrent synthetic edit"}]}:{})});
 });await expect(f.client.labelExisting(group,"people/synthetic1",phone)).rejects.toThrow("GOOGLE_CONTACTS_");
 if(mode==="system-group"||mode==="wrong-phone")expect(mutated).toBe(false);
});
test("concurrent requests serialize the same client membership boundary; failed attempt releases the queue",async()=>{
 let applied=false,mutations=0,fail=true;const f=fixture(async path=>{
  if(path.includes("members:modify")){mutations++;await new Promise(resolve=>setTimeout(resolve,5));if(fail){fail=false;return json({},503);}applied=true;return json({});}
  return path.startsWith("/v1/contactGroups/")?json(groupValue()):json(person("people/synthetic1",applied?[group,"contactGroups/unrelated"]:["contactGroups/unrelated"]));
 });await expect(f.client.labelExisting(group,"people/synthetic1",phone)).rejects.toThrow("GOOGLE_CONTACTS_UNAVAILABLE");
 const results=await Promise.all(Array.from({length:4},()=>f.client.labelExisting(group,"people/synthetic1",phone)));
 expect(results.filter(r=>!r.replayed)).toHaveLength(1);expect(mutations).toBe(2);
});
test.each([0,1,2,30])("warmed phone lookup %s does not confuse miss/saturation/duplicates with verified absence",async count=>{
 const f=fixture(path=>{const u=new URL("https://people.googleapis.com"+path);return json({results:u.searchParams.get("query")?Array.from({length:count},(_,i)=>({person:person("people/synthetic"+i)})):[]});});
 if(count===30)await expect(f.client.findByPhone(phone)).rejects.toThrow("GOOGLE_CONTACTS_BOUNDED_LIMIT");
 else expect(await f.client.findByPhone(phone)).toMatchObject({state:count===1?"existing":count===2?"ambiguous":"absence_unverified"});
 const search=f.calls.filter(c=>c.url.pathname.includes("searchContacts"));expect(search).toHaveLength(2);expect(search[0]!.url.searchParams.get("query")).toBe("");expect(search[1]!.url.searchParams.get("query")).toBe(phone);
 expect(f.calls.some(c=>c.url.pathname.includes("createContact"))).toBe(false);
});
test("actual response bytes are bounded without trusting Content-Length; errors disclose no private provider body",async()=>{
 const large=fixture(()=>new Response(" ".repeat(524289),{headers:{"content-type":"application/json"}}));await expect(large.client.readPerson("people/synthetic1")).rejects.toThrow("GOOGLE_CONTACTS_BOUNDED_LIMIT");
 const denied=fixture(()=>json({error:"synthetic-private-provider-body"},403));await expect(denied.client.readPerson("people/synthetic1")).rejects.toThrow("GOOGLE_CONTACTS_PERMISSION");
 const wrong=fixture(()=>json(person("people/other")));await expect(wrong.client.readPerson("people/synthetic1")).rejects.toThrow("GOOGLE_CONTACTS_CONFLICT");
 const malformed=fixture(()=>new Response(new Uint8Array([255]),{headers:{"content-type":"application/json"}}));await expect(malformed.client.readPerson("people/synthetic1")).rejects.toThrow("GOOGLE_CONTACTS_UNAVAILABLE");
});
test("resource injection and people/me cannot trigger arbitrary provider reads",async()=>{
 const f=fixture(()=>{throw Error("NO_PEOPLE_CALL_ALLOWED");});for(const resource of ["people/me","https://evil.invalid/people/1","people/../me","people/a?fields=biographies"])
  await expect(f.client.readPerson(resource)).rejects.toThrow("GOOGLE_CONTACTS_CONFLICT");expect(f.calls).toHaveLength(0);
});
