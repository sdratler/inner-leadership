import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {PublicGroupApplicationStore} from "../../src/features/group-application/store.ts";
import {InquiryEmailOutbox} from "../../src/features/group-application/inquiry-email.ts";
import {INQUIRY_EMAIL_FROM} from "../../src/features/group-application/inquiry-email-copy.ts";
import {floridaGroupApplicationNotice,type FloridaParentApplicationFields} from "../../src/features/group-application/contract.ts";
import {seal} from "../../src/features/identity/crypto.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import {asId} from "../../src/lib/ids.ts";

const db=new PGlite(),workspace=asId(randomUUID(),"workspace"),now=new Date("2029-01-01T12:00:00Z"),clock={now:()=>now};
const ring={activeKeyId:"test",keys:{test:Buffer.alloc(32,9)}},key="synthetic-inquiry-email-test-key";
const store:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>(await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const application=new PublicGroupApplicationStore(store,workspace,ring,key,clock,true);
const outbox=new InquiryEmailOutbox(store,workspace,ring,clock),actors:Actor[]=[];
function command(overrides:Partial<FloridaParentApplicationFields>={}){return {operationId:randomUUID(),fields:{parentName:"Synthetic Parent",contact:`p-${randomUUID()}@example.invalid`,language:"en",childAge:"10",cityArea:"Hollywood",programId:"sunday_fishing_academy",schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"},...overrides} as FloridaParentApplicationFields};}
async function row(reference:string){return (await db.query<{id:string;state:string;payload_ciphertext:string;provider_id:string|null}>("SELECT * FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2",[workspace,reference])).rows[0]!;}
beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");
 for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql","0131_ls_public_group_applications.sql","0135_ls_public_inquiry_email_outbox.sql"])await db.exec(await readFile("migrations/"+name,"utf8"));
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
 for(const role of ["practitioner","parent"] as const){const id=randomUUID(),digest=id.replaceAll("-","").padEnd(64,"0");
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspace,role,digest,now]);
  await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,id]);
  await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspace,id,now,new Date(now.getTime()+86400000)]);
  actors.push({id,workspaceId:workspace,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:now.getTime()+86400000} as Actor);
 }
},20000);
afterAll(async()=>db.close());
it("commits encrypted one-to-one mail intent with the inquiry; exact and new-key replays never duplicate it",async()=>{
 const input=command(),saved=await application.submit(input),first=await row(saved.item.id);
 expect(saved).toMatchObject({saved:true,acknowledgment:"queued"});expect(first.state).toBe("queued");
 expect(first.payload_ciphertext).not.toContain(input.fields.contact);expect(first.payload_ciphertext).not.toContain(saved.item.id);
 expect((await application.submit(input)).item.id).toBe(saved.item.id);
 expect((await application.submit({...input,operationId:randomUUID()})).item.id).toBe(saved.item.id);
 await expect(application.submit({...input,fields:{...input.fields,childAge:"11"}})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await db.query("SELECT id FROM ls_service_interest.inquiry_email_outbox WHERE application_id=$1",[saved.item.id])).rows).toEqual([{id:first.id}]);
 expect(await application.list(actors[0]!)).toContainEqual(saved.item);await expect(application.list(actors[1]!)).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("keeps phone-only and other programs valid without inventing a destination",async()=>{
 for(const input of [command({contact:"+15550003111"}),command({programId:"private_fishing_life_skills"})]){const saved=await application.submit(input);expect(saved).toMatchObject({acknowledgment:"not_requested"});expect(await row(saved.item.id)).toBeUndefined();}
});
it("OFF remains compatible with pre-outbox databases and never queries the email table",async()=>{
 const guarded:IdentityStore={transaction:fn=>store.transaction(tx=>fn({query:(sql,values)=>{if(sql.includes("inquiry_email_outbox"))throw Error("unexpected mail");return tx.query(sql,values);}}))};
 const saved=await new PublicGroupApplicationStore(guarded,workspace,ring,key,clock).submit(command());
 expect(saved).not.toHaveProperty("acknowledgment");expect(await row(saved.item.id)).toBeUndefined();
});
it("rolls back both inquiry and operation if atomic queue persistence fails",async()=>{
 const input=command(),before=(await db.query("SELECT count(*)::int AS n FROM ls_service_interest.public_applications WHERE workspace_id=$1",[workspace])).rows;const broken:IdentityStore={transaction:fn=>store.transaction(tx=>fn({query:(sql,values)=>{if(sql.startsWith("INSERT INTO ls_service_interest.inquiry_email_outbox"))throw Error("queue unavailable");return tx.query(sql,values);}}))};
 await expect(new PublicGroupApplicationStore(broken,workspace,ring,key,clock,true).submit(input)).rejects.toThrow("queue unavailable");
 expect((await db.query("SELECT operation_id FROM ls_service_interest.public_application_operations WHERE operation_id=$1",[input.operationId])).rows).toEqual([]);
 expect((await db.query("SELECT count(*)::int AS n FROM ls_service_interest.public_applications WHERE workspace_id=$1",[workspace])).rows).toEqual(before);
 expect(await new PublicGroupApplicationStore(store,workspace,ring,key,clock).replaySaved(input)).toBeNull();
});
it("a fresh worker sends only after the native commit and committed unknown reservation, outside the DB transaction",async()=>{
 const input=command({language:"he",permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"he"}}),saved=await application.submit(input),mail=await row(saved.item.id);
 const send=vi.fn(async(message:{to:string;text:string;idempotencyKey:string})=>{
  expect((await row(saved.item.id)).state).toBe("unknown");expect(message.to).toBe(input.fields.contact);expect(message.text).toContain(saved.item.id);expect(message.text).toContain("אינה אישור הרשמה");expect(message.idempotencyKey).toBe(`ls-auth-${mail.id}`);return {providerId:"synthetic_mail_1"};
 });
 expect(await new InquiryEmailOutbox(store,workspace,ring,clock).dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("sent");
 expect(await row(saved.item.id)).toMatchObject({state:"sent",provider_id:"synthetic_mail_1"});
 expect(await outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("idle");expect(send).toHaveBeenCalledTimes(1);
});
it("unknown network results survive a new worker and replay without resending",async()=>{
 const input=command(),saved=await application.submit(input),mail=await row(saved.item.id),send=vi.fn(async()=>{throw Error("unknown external result");});
 expect(await outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("unknown");await application.submit(input);
 expect(await new InquiryEmailOutbox(store,workspace,ring,clock).dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("idle");
 expect(send).toHaveBeenCalledTimes(1);expect((await row(saved.item.id)).state).toBe("unknown");
 await expect(outbox.reconcile(actors[1]!,mail.id,{state:"sent",providerId:"verified_provider_2"})).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(await outbox.reconcile(actors[0]!,mail.id,{state:"sent",providerId:"verified_provider_2"})).toBe("sent");
 await expect(outbox.reconcile(actors[0]!,mail.id,{state:"canceled"})).rejects.toMatchObject({code:"CONFLICT"});
});
it("DB failure after a successful provider response leaves unknown and never automatically sends again",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id),send=vi.fn(async()=>({providerId:"synthetic_mail_3"}));
 const broken:IdentityStore={transaction:fn=>store.transaction(tx=>fn({query:(sql,values)=>{if(sql.includes("SET state='sent'"))throw Error("commit failed");return tx.query(sql,values);}}))};
 expect(await new InquiryEmailOutbox(broken,workspace,ring,clock).dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("unknown");
 expect(await outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("idle");expect(send).toHaveBeenCalledTimes(1);
});
it("concurrent worker reservations cannot deliver twice",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id),send=vi.fn(async()=>({providerId:"synthetic_mail_4"}));
 expect((await Promise.all([outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM),outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)])).sort()).toEqual(["idle","sent"]);expect(send).toHaveBeenCalledTimes(1);
});
it("post-commit HTTP dispatch by native reference shares the same durable no-resend state across retries",async()=>{
 const input=command(),saved=await application.submit(input),send=vi.fn(async()=>({providerId:"synthetic_post_commit"}));
 expect(await outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM)).toBe("sent");
 await application.submit(input);expect(await outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM)).toBe("sent");
 expect(send).toHaveBeenCalledTimes(1);expect(await outbox.dispatchForApplication(randomUUID(),{send},INQUIRY_EMAIL_FROM)).toBe("not_requested");
});
it("rejects mismatched recipient/purpose before network, even with valid ciphertext",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id),send=vi.fn();
 const payload={purpose:"academy_inquiry_acknowledgment_v1",reference:saved.item.id,recipient:"other@example.invalid",locale:"en"};
 await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[workspace,mail.id,seal(JSON.stringify(payload),`ls_service_interest/inquiry_email/v1/${workspace}/${mail.id}`,ring)]);
 await expect(outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).rejects.toMatchObject({code:"UNAVAILABLE"});expect(send).not.toHaveBeenCalled();expect((await row(saved.item.id)).state).toBe("queued");
});
it("workspace scoping and sender restrictions prevent cross-destination delivery",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id),send=vi.fn();
 const other=asId(randomUUID(),"workspace");await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[other,now]);
 expect(await new InquiryEmailOutbox(store,other,ring,clock).dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("idle");
 await expect(outbox.dispatchOne(mail.id,{send},"wrong@example.invalid")).rejects.toMatchObject({code:"INVALID_REQUEST"});expect(send).not.toHaveBeenCalled();
});
it("rechecks a revoked practitioner session before unknown reconciliation",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id);await outbox.dispatchOne(mail.id,{send:async()=>{throw Error();}},INQUIRY_EMAIL_FROM);
 await db.query("UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1",[actors[0]!.sessionDigest,now]);
 await expect(outbox.reconcile(actors[0]!,mail.id,{state:"canceled"})).rejects.toMatchObject({code:"UNAUTHENTICATED"});expect((await row(saved.item.id)).state).toBe("unknown");
});
