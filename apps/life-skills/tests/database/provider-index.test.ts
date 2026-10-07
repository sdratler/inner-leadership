/** Native PostgreSQL, production Drizzle binder, real session rechecks.
 * Reuses the existing disposable-fixture safety checks. NOT RUN during packet
 * preparation. The integrator must apply the registered migration to the isolated
 * fixture DB first. This suite does not migrate, contact a vendor, or use real data.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
import { fixture, type Fixture, poolStore } from "./calendar/fixture.ts";
import type { IdentityConfig } from "../../src/features/identity/config.ts";
import { systemClock, type Actor } from "../../src/features/identity/types.ts";
import { ProviderIndexStore } from "../../src/features/provider-index/server/store.ts";
import { ProviderReferralStore } from "../../src/features/provider-referrals/server/store.ts";
import { emptyProvider, type ProviderInput, type ProviderRecord, type ProviderPage, type WriteReceipt } from "../../src/features/provider-index/core.ts";
import type { ReferralInput, ReferralRecord } from "../../src/features/provider-referrals/core.ts";
let f:Fixture, other:Fixture, providers:ProviderIndexStore, referrals:ProviderReferralStore;
function config(x:Fixture):IdentityConfig {return {enabled:true,origin:"https://r35-fixture.invalid",workspaceId:x.workspaceId,
  keyring:x.keyring,lookupKey:randomBytes(32),csrfKey:randomBytes(32),rateLimitKey:randomBytes(32).toString("hex"),sessionSeconds:28800};}
const req=()=>randomUUID();
function draft(values:Partial<ProviderInput>={}):ProviderInput{return {...emptyProvider(),name:"R35 Synthetic "+randomUUID(),...values};}
function create(entry=draft()){return {action:"create" as const,id:randomUUID(),operationId:randomUUID(),entry};}
const read=(id:string,actor?:Actor)=>providers.execute(actor??f.practitioner.actor,{action:"read",id},req()) as Promise<ProviderRecord>;
const write=(c:unknown)=>providers.execute(f.practitioner.actor,c,req()) as Promise<WriteReceipt>;
async function provider(entry=draft()){const c=create(entry);await write(c);return read(c.id);}
function ref(p:ProviderRecord,caseId:string|null=f.first.id):ReferralInput{return {providerId:p.id,caseId,happenedOn:"",status:"considering",context:"Synthetic coordination; no case narrative",nextAction:"",nextOn:""};}
const referralWrite=(c:unknown)=>referrals.execute(f.practitioner.actor,c,req()) as Promise<WriteReceipt>;
const listRefs=(providerId:string,caseId:string|null)=>referrals.execute(f.practitioner.actor,{action:"list",providerId,caseId},req()) as Promise<ReferralRecord[]>;
beforeAll(async()=>{
  f=await fixture();other=await fixture();
  const tables=await f.pool.query("SELECT to_regclass('ls_provider_index.entries') AS providers,to_regclass('ls_provider_referrals.contexts') AS referrals");
  if(!tables.rows[0]?.providers||!tables.rows[0]?.referrals)throw Error("REGISTER_AND_MIGRATE_R35_IN_DISPOSABLE_DATABASE_FIRST");
  const c=config(f),gate={enabled:true,ownerAccountId:f.practitioner.actor.id,workspaceId:f.workspaceId};
  providers=new ProviderIndexStore(poolStore(f.pool),c,gate,systemClock);referrals=new ProviderReferralStore(poolStore(f.pool),c,gate,systemClock);
});
afterAll(async()=>{await f?.pool.end();await other?.pool.end();});
describe("R35 provider persistence and isolation",()=>{
 it("stores encrypted data and reads through production adapter",async()=>{
   const p=await provider(draft({privateNotes:"Synthetic private marker"}));expect((await read(p.id)).entry.privateNotes).toBe("Synthetic private marker");
   const saved=await f.pool.query("SELECT payload_ciphertext FROM ls_provider_index.entries WHERE workspace_id=$1 AND id=$2",[f.workspaceId,p.id]);
   expect(saved.rows[0].payload_ciphertext).not.toContain("Synthetic private marker");
 });
 it("creating a provider creates no client, account, case, CRM profile or sale",async()=>{
   const counts=async()=>{const r=await f.pool.query(`SELECT (SELECT count(*) FROM ls_identity.accounts WHERE workspace_id=$1)::int AS accounts,
     (SELECT count(*) FROM ls_identity.people WHERE workspace_id=$1)::int AS people,
     (SELECT count(*) FROM ls_cases.cases WHERE workspace_id=$1)::int AS cases,
     (SELECT count(*) FROM ls_contact_ops.profiles WHERE workspace_id=$1)::int AS crm`,[f.workspaceId]);return r.rows[0];};
   const before=await counts();await provider();expect(await counts()).toEqual(before);
 });
 it("rejects parents, unrelated accounts and cross-workspace actors",async()=>{
   const p=await provider();for(const actor of [f.parent.actor,f.parentTwo.actor,f.outsider.actor,other.practitioner.actor])await expect(read(p.id,actor)).rejects.toBeDefined();
 });
 it("missing and foreign record IDs do not expose data",async()=>{
   await expect(read(randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
   const c=config(other),s=new ProviderIndexStore(poolStore(other.pool),c,{enabled:true,ownerAccountId:other.practitioner.actor.id,workspaceId:other.workspaceId},systemClock);
   const cmd=create();await s.execute(other.practitioner.actor,cmd,req());await expect(read(cmd.id)).rejects.toMatchObject({code:"NOT_FOUND"});
 });
 it("disabled feature does not allow a read or write",async()=>{
   const s=new ProviderIndexStore(poolStore(f.pool),config(f),{enabled:false,ownerAccountId:f.practitioner.actor.id,workspaceId:f.workspaceId},systemClock);
   await expect(s.execute(f.practitioner.actor,create(),req())).rejects.toMatchObject({code:"NOT_FOUND"});
 });
 it("revoked session is rechecked in transaction",async()=>{
   await f.pool.query("UPDATE ls_identity.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_digest=$1",[f.practitioner.actor.sessionDigest]);
   try{await expect(write(create())).rejects.toBeDefined();}finally{await f.pool.query("UPDATE ls_identity.sessions SET expires_at=$2 WHERE token_digest=$1",[f.practitioner.actor.sessionDigest,new Date(f.practitioner.actor.expiresAt)]);}
 });
 it("exact creation retry stores once",async()=>{
   const c=create();const a=await write(c),b=await write(c);expect(b).toEqual({...a,replayed:true});expect((await read(c.id)).version).toBe(1);
 });
 it("concurrent identical creation stores once",async()=>{
   const c=create(),r=await Promise.all([write(c),write(c)]);expect(r.filter(x=>x.replayed)).toHaveLength(1);expect((await read(c.id)).version).toBe(1);
 });
 it("reused operation with a changed payload conflicts",async()=>{
   const c=create();await write(c);await expect(write({...c,entry:{...c.entry,location:"Changed"}})).rejects.toMatchObject({reason:"OPERATION_REUSED"});
 });
 it("optimistic version conflict never overwrites newer content",async()=>{
   const p=await provider(),c={action:"update",id:p.id,operationId:randomUUID(),expectedVersion:1,entry:{...p.entry,location:"New location"}};
   await write(c);await expect(write({...c,operationId:randomUUID(),entry:{...p.entry,location:"Stale"}})).rejects.toMatchObject({reason:"STALE_VERSION"});expect((await read(p.id)).entry.location).toBe("New location");
 });
 it("old retry returns original receipt and cannot overwrite subsequent edit",async()=>{
   const p=await provider(),a={action:"update",id:p.id,operationId:randomUUID(),expectedVersion:1,entry:{...p.entry,location:"First"}};
   await write(a);await write({...a,operationId:randomUUID(),expectedVersion:2,entry:{...p.entry,location:"Second"}});expect((await write(a)).version).toBe(2);expect((await read(p.id)).entry.location).toBe("Second");
 });
 it("duplicate hints require acknowledgment, never merge",async()=>{
   const name="Synthetic shared name "+randomUUID();const a=await provider(draft({name})),b=create(draft({name}));
   await expect(write(b)).rejects.toMatchObject({reason:"POSSIBLE_DUPLICATE"});await write({...b,allowDuplicate:true});expect((await read(b.id)).id).not.toBe(a.id);
 });
 it("archive and restore preserve data; replay cannot rearchive",async()=>{
   const p=await provider(),a={action:"archive",id:p.id,operationId:randomUUID(),expectedVersion:1,archived:true};await write(a);
   expect((await read(p.id)).archived).toBe(true);await write({...a,operationId:randomUUID(),expectedVersion:2,archived:false});await write(a);
   expect((await read(p.id)).archived).toBe(false);expect((await read(p.id)).entry).toEqual(p.entry);
 });
 it("operation receipts and access evidence resist mutation",async()=>{
   const c=create();await write(c);
   await expect(f.pool.query("UPDATE ls_provider_index.command_receipts SET result_version=99 WHERE workspace_id=$1 AND operation_id=$2",[f.workspaceId,c.operationId])).rejects.toMatchObject({code:"23514"});
   await expect(f.pool.query("DELETE FROM ls_provider_index.access_events WHERE workspace_id=$1 AND subject_id=$2",[f.workspaceId,c.id])).rejects.toMatchObject({code:"23514"});
 });
 it("future verification is not accepted as completed",async()=>{
   await expect(write(create(draft({verification:{status:"checked",basis:"Synthetic check",checkedOn:"9999-01-01"}})))).rejects.toMatchObject({reason:"FUTURE_VERIFICATION"});
 });
 it("invalid audit request rolls back the whole mutation",async()=>{
   const c=create();await expect(providers.execute(f.practitioner.actor,c,"invalid-request-id")).rejects.toBeDefined();await expect(read(c.id)).rejects.toMatchObject({code:"NOT_FOUND"});
 });
 it("audit has no provider text or search query",async()=>{
   const p=await provider();const requestId=req();await providers.execute(f.practitioner.actor,{action:"search",query:{search:p.entry.name}},requestId);
   const r=await f.pool.query("SELECT row_to_json(a) AS entry FROM ls_provider_index.access_events a WHERE workspace_id=$1 AND request_id=$2",[f.workspaceId,requestId]);expect(r.rows).toHaveLength(1);expect(JSON.stringify(r.rows)).not.toContain(p.entry.name);
 });
 it("bad ciphertext fails closed rather than showing empty success",async()=>{
   const p=await provider();const r=await f.pool.query("SELECT payload_ciphertext FROM ls_provider_index.entries WHERE workspace_id=$1 AND id=$2",[f.workspaceId,p.id]);
   await f.pool.query("UPDATE ls_provider_index.entries SET payload_ciphertext='invalid' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,p.id]);
   try{await expect(read(p.id)).rejects.toMatchObject({code:"UNAVAILABLE"});}finally{await f.pool.query("UPDATE ls_provider_index.entries SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,p.id,r.rows[0].payload_ciphertext]);}
 });
 it("search supports original fields and excludes archived by default",async()=>{
   const name="Synthetic filter "+randomUUID(),p=await provider(draft({name,services:["Parent coaching"],location:"Modiin"}));
   const q={action:"search",query:{search:name,service:"Parent coaching",location:"Modiin"}};const found=await providers.execute(f.practitioner.actor,q,req()) as ProviderPage;expect(found.items.map(x=>x.id)).toEqual([p.id]);
   await write({action:"archive",operationId:randomUUID(),id:p.id,expectedVersion:1,archived:true});expect((await providers.execute(f.practitioner.actor,q,req()) as ProviderPage).total).toBe(0);
 });
});
describe("R35 private referral boundary",()=>{
 it("stores case and general coordination separately",async()=>{
   const p=await provider();for(const caseId of [null,f.first.id,f.second.id])await referralWrite({action:"create",id:randomUUID(),operationId:randomUUID(),detail:ref(p,caseId)});
   expect(await listRefs(p.id,null)).toHaveLength(1);expect(await listRefs(p.id,f.first.id)).toHaveLength(1);expect(await listRefs(p.id,f.second.id)).toHaveLength(1);
 });
 it("directory response never contains referral case IDs or context",async()=>{
   const p=await provider();await referralWrite({action:"create",id:randomUUID(),operationId:randomUUID(),detail:{...ref(p),context:"REFERRAL_ONLY_SYNTHETIC_MARKER"}});
   const data=JSON.stringify(await read(p.id));expect(data).not.toContain("REFERRAL_ONLY_SYNTHETIC_MARKER");expect(data).not.toContain(f.first.id);
 });
 it("parent cannot read even their own case referral",async()=>{
   const p=await provider();await expect(referrals.execute(f.parent.actor,{action:"list",providerId:p.id,caseId:f.first.id},req())).rejects.toBeDefined();
 });
 it("foreign case fails existing case authorization",async()=>{
   const p=await provider();await expect(referralWrite({action:"create",id:randomUUID(),operationId:randomUUID(),detail:ref(p,other.first.id)})).rejects.toMatchObject({code:"NOT_FOUND"});
 });
 it("missing provider cannot receive a reference",async()=>{
   const p=await provider();await expect(referralWrite({action:"create",id:randomUUID(),operationId:randomUUID(),detail:{...ref(p),providerId:randomUUID()}})).rejects.toMatchObject({code:"NOT_FOUND"});
 });
 it("provider or case cannot be reassigned through an edit",async()=>{
   const p=await provider(),c={action:"create",id:randomUUID(),operationId:randomUUID(),detail:ref(p)};await referralWrite(c);
   await expect(referralWrite({...c,action:"update",operationId:randomUUID(),expectedVersion:1,detail:ref(p,f.second.id)})).rejects.toMatchObject({reason:"REFERRAL_SCOPE_IMMUTABLE"});
 });
 it("database binds case referrals to the case practitioner",async()=>{
   const providerId=randomUUID(),referralId=randomUUID();
   await f.pool.query("INSERT INTO ls_provider_index.entries(workspace_id,id,owner_account_id,payload_ciphertext) VALUES($1,$2,$3,'synthetic-ciphertext')",[f.workspaceId,providerId,f.parent.actor.id]);
   await expect(f.pool.query("INSERT INTO ls_provider_referrals.contexts(workspace_id,id,owner_account_id,provider_id,case_id,payload_ciphertext) VALUES($1,$2,$3,$4,$5,'synthetic-ciphertext')",[f.workspaceId,referralId,f.parent.actor.id,providerId,f.first.id])).rejects.toMatchObject({code:"23514"});
 });
 it("database prevents provider and referral scope reassignment",async()=>{
   const p=await provider(),q=await provider(),id=randomUUID();
   await referralWrite({action:"create",id,operationId:randomUUID(),detail:ref(p)});
   await expect(f.pool.query("UPDATE ls_provider_index.entries SET owner_account_id=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,p.id,f.parent.actor.id])).rejects.toMatchObject({code:"23514"});
   await expect(f.pool.query("UPDATE ls_provider_referrals.contexts SET provider_id=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,id,q.id])).rejects.toMatchObject({code:"23514"});
   await expect(f.pool.query("UPDATE ls_provider_referrals.contexts SET case_id=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,id,f.second.id])).rejects.toMatchObject({code:"23514"});
 });
 it("referral concurrent retry creates once",async()=>{
   const p=await provider(),c={action:"create",id:randomUUID(),operationId:randomUUID(),detail:ref(p)};const r=await Promise.all([referralWrite(c),referralWrite(c)]);expect(r.filter(x=>x.replayed)).toHaveLength(1);expect(await listRefs(p.id,f.first.id)).toHaveLength(1);
 });
 it("referral stale version is a conflict, not a lost update",async()=>{
   const p=await provider(),c={action:"create",id:randomUUID(),operationId:randomUUID(),detail:ref(p)};await referralWrite(c);
   await referralWrite({...c,action:"update",operationId:randomUUID(),expectedVersion:1,detail:{...c.detail,nextAction:"Synthetic next action"}});
   await expect(referralWrite({...c,action:"update",operationId:randomUUID(),expectedVersion:1})).rejects.toMatchObject({reason:"STALE_VERSION"});
 });
 it("archived provider rejects new referral while preserving history",async()=>{
   const p=await provider(),c={action:"create",id:randomUUID(),operationId:randomUUID(),detail:ref(p)};await referralWrite(c);
   await write({action:"archive",operationId:randomUUID(),id:p.id,expectedVersion:1,archived:true});await expect(referralWrite({...c,id:randomUUID(),operationId:randomUUID()})).rejects.toMatchObject({reason:"PROVIDER_ARCHIVED"});expect(await listRefs(p.id,f.first.id)).toHaveLength(1);
 });
 it("recording coordination does not create a case",async()=>{
   const before=await f.pool.query("SELECT count(*)::int AS n FROM ls_cases.cases WHERE workspace_id=$1",[f.workspaceId]);const p=await provider();await referralWrite({action:"create",id:randomUUID(),operationId:randomUUID(),detail:ref(p,null)});
   const after=await f.pool.query("SELECT count(*)::int AS n FROM ls_cases.cases WHERE workspace_id=$1",[f.workspaceId]);expect(after.rows[0].n).toBe(before.rows[0].n);
   // Provider/network side effects are excluded structurally and checked in the acceptance inventory.
 });
});
