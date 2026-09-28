import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import type {CrmProfile} from "../../../src/features/contact-ops/server/native-store.ts";
import {NativeCrmStore} from "../../../src/features/contact-ops/server/native-store.ts";
const fixtures:Fixture[]=[];
afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key="synthetic-operational-integrity-key-20260928";
// Fixture receipts are isolated synthetic gate inputs, never live cutover proof.
const proof=(epoch:number,writes=0):CutoverEvidence=>({batchId:"synthetic-operational-batch",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",expectedEpoch:epoch,observedNativeWritesSinceSwitch:writes,
 backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,
 inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
async function setup(){const f=await fixture();fixtures.push(f);const db=poolStore(f.pool);return {f,db,authority:new ContactCutoverStore(db,f.keyring,key),store:new OperationalNativeCrmStore(db,f.keyring,key)};}
async function activate(s:Awaited<ReturnType<typeof setup>>){for(const [i,action] of (["prepare","freeze","switch_native"] as const).entries())await s.authority.advance(s.f.practitioner.actor,{action,proof:proof(i),operationId:action});}
const profile=(personId:string,notes="Synthetic preserved administrative note"):CrmProfile=>({personId,stage:"New inquiry",nextAction:"Respond to inquiry",followUpDate:"2026-09-28",notes,legacyIds:[]});
const query={view:"all" as const,search:"",today:"2026-09-28",page:1,pageSize:20};

test("operational native APIs reject legacy, frozen and stale authority without touching CRM rows",async()=>{
 const s=await setup(),a=s.f.practitioner.actor,p=profile(a.personId);
 for(const [epoch,phase] of [[0,"sheet_active"],[1,"shadow_ready"],[2,"frozen"]] as const){
  expect(await s.authority.read(a)).toMatchObject({phase,epoch});
  await expect(s.store.create(a,p,"denied-create-"+epoch,epoch)).rejects.toThrow("CONFLICT");
  await expect(s.store.update(a,p,1,"denied-update-"+epoch,epoch)).rejects.toThrow("CONFLICT");
  await expect(s.store.read(a,p.personId,epoch)).rejects.toThrow("CONFLICT");
  await expect(s.store.list(a,query,epoch)).rejects.toThrow("CONFLICT");
  if(epoch<2)await s.authority.advance(a,{action:epoch===0?"prepare":"freeze",proof:proof(epoch),operationId:"advance-"+epoch});
 }
 await s.authority.advance(a,{action:"switch_native",proof:proof(2),operationId:"switch"});
 await expect(s.store.create(a,p,"stale",2)).rejects.toThrow("CONFLICT");
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.profiles WHERE workspace_id=$1",[a.workspaceId])).rows[0].n).toBe(0);
 expect((await s.authority.read(a)).nativeWritesSinceSwitch).toBe(0);
});

test("one real transaction binds native create/read/list/update, notes, replay and write accounting",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,p=profile(a.personId);
 let transactions=0;const statements:string[]=[];
 const counted:IdentityStore={transaction:work=>{transactions++;return s.db.transaction(tx=>work({query:async<T extends object>(sql:string,v?:readonly unknown[])=>{statements.push(sql);return tx.query<T>(sql,v);}}));}};
 const store=new OperationalNativeCrmStore(counted,s.f.keyring,key);
 expect(await store.create(a,p,"native-create",3)).toEqual({version:1,replayed:false});
 expect(transactions).toBe(1);
 expect(await store.read(a,p.personId,3)).toMatchObject({profile:p,version:1});
 expect(transactions).toBe(2);
 statements.length=0;
 expect(await store.list(a,{...query,personId:p.personId},3)).toMatchObject({total:1,items:[{personId:p.personId,notes:p.notes}]});
 expect(transactions).toBe(3);
 expect(statements[0]).toBe("SET TRANSACTION READ ONLY");
 expect(statements.filter(sql=>sql.startsWith("SET TRANSACTION"))).toHaveLength(1);
 const directory=await store.list(a,query,3);
 expect(directory.total).toBe(3);
 expect(new Set(directory.items.map(row=>row.personId)).size).toBe(3);
 expect(directory.items.filter(row=>row.version===null)).toHaveLength(2);
 const updated={...p,nextAction:"Follow up tomorrow"};
 expect(await store.update(a,updated,1,"native-update",3)).toEqual({version:2,replayed:false});
 expect(await store.update(a,updated,1,"native-update",3)).toEqual({version:2,replayed:true});
 expect(await store.read(a,p.personId,3)).toMatchObject({profile:updated,version:2});
 // Conservative counter records every committed write intent, including replay;
 // failed attempts and reads never advance it. No native delta is understated.
 expect((await s.authority.read(a)).nativeWritesSinceSwitch).toBe(3);
 await expect(store.update(a,{...p,notes:"Uncommitted stale note"},1,"stale-update",3)).rejects.toThrow("STALE_PROFILE_VERSION");
 expect((await s.authority.read(a)).nativeWritesSinceSwitch).toBe(3);
 const ciphertext=(await s.f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[a.workspaceId,p.personId])).rows[0].payload_ciphertext;
 expect(ciphertext).not.toContain(p.notes);
 expect(await store.read(a,p.personId,3)).toMatchObject({profile:updated,version:2});
});

test("counter-persistence failure rolls back the profile and its idempotency receipt together",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,p=profile(a.personId);
 const failing:IdentityStore={transaction:work=>s.db.transaction(tx=>work({query:async<T extends object>(sql:string,v?:readonly unknown[])=>{
  if(sql.startsWith("INSERT INTO ls_contact_ops.cutover("))throw Error("SYNTHETIC_COUNTER_SAVE_FAILURE");return tx.query<T>(sql,v);
 }}))};
 const store=new OperationalNativeCrmStore(failing,s.f.keyring,key);
 await expect(store.create(a,p,"rolled-back-create",3)).rejects.toThrow("SYNTHETIC_COUNTER_SAVE_FAILURE");
 expect(await s.store.read(a,p.personId,3)).toBeNull();
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.command_receipts WHERE workspace_id=$1 AND operation_id=$2",[a.workspaceId,"rolled-back-create"])).rows[0].n).toBe(0);
 expect((await s.authority.read(a)).nativeWritesSinceSwitch).toBe(0);
 expect(await s.store.create(a,p,"rolled-back-create",3)).toEqual({version:1,replayed:false});
 expect((await s.authority.read(a)).nativeWritesSinceSwitch).toBe(1);
});

test("competing saves serialize under the authority fence and preserve the winning notes",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,p=profile(a.personId);await s.store.create(a,p,"create",3);
 const notes=["Synthetic first candidate note","Synthetic second candidate note"];
 const outcomes=await Promise.allSettled(notes.map((note,i)=>s.store.update(a,{...p,notes:note},1,"save-"+i,3)));
 expect(outcomes.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(outcomes.filter(x=>x.status==="rejected")).toHaveLength(1);
 const saved=await s.store.read(a,p.personId,3);expect(saved?.version).toBe(2);expect(notes).toContain(saved?.profile.notes);
 expect((await s.authority.read(a)).nativeWritesSinceSwitch).toBe(2);
});

test("a read waiting for the authority lock sees the committed rollback hold, not a pre-lock snapshot",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,p=profile(a.personId);await s.store.create(a,p,"create",3);
 let markWaiting!:(pid:number)=>void;const waiting=new Promise<number>(resolve=>{markWaiting=resolve;});
 const observed:IdentityStore={transaction:work=>s.db.transaction(tx=>work({query:async<T extends object>(sql:string,v?:readonly unknown[])=>{
  if(sql.includes("pg_advisory_xact_lock")){const [r]=await tx.query<{pid:number}>("SELECT pg_backend_pid() AS pid");markWaiting(r!.pid);}
  return tx.query<T>(sql,v);
 }}))};
 const reader=new OperationalNativeCrmStore(observed,s.f.keyring,key);
 let result!:Promise<unknown>;
 await s.db.transaction(async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${a.workspaceId}:contact-authority`]);
  result=reader.read(a,p.personId,3).then(value=>({value}),error=>({error:String(error)}));
  const pid=await waiting;
  let blocked=false;
  for(let n=0;n<100;n++){
   const [state]=await tx.query<{wait:string|null}>("SELECT wait_event AS wait FROM pg_stat_activity WHERE pid=$1",[pid]);
   if(state?.wait==="advisory"){blocked=true;break;}
   await new Promise(resolve=>setTimeout(resolve,5));
  }
  expect(blocked).toBe(true);
  const scoped:IdentityStore={transaction:work=>work(tx)};
  await new ContactCutoverStore(scoped,s.f.keyring,key).advance(a,{action:"prepare_rollback",proof:proof(3,1),operationId:"hold-while-reader-waits"});
 });
 expect(await result).toMatchObject({error:expect.stringContaining("CONFLICT")});
 expect(await s.authority.read(a)).toMatchObject({phase:"rollback_prepared",epoch:4});
});

test("real session/role/workspace denial applies to every operational method including replay",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,p=profile(a.personId);await s.store.create(a,p,"create",3);
 for(const actor of [s.f.parent.actor,{...a,workspaceId:randomUUID() as typeof a.workspaceId}]){
  const error=actor.role==="parent"?"FORBIDDEN":"UNAUTHENTICATED";
  await expect(s.store.read(actor,p.personId,3)).rejects.toThrow(error);await expect(s.store.list(actor,query,3)).rejects.toThrow(error);
  await expect(s.store.create(actor,p,"create",3)).rejects.toThrow(error);await expect(s.store.update(actor,p,1,"update",3)).rejects.toThrow(error);
 }
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[a.sessionDigest]);
 await expect(s.store.create(a,p,"create",3)).rejects.toThrow("UNAUTHENTICATED");
 await expect(s.store.read(a,p.personId,3)).rejects.toThrow("UNAUTHENTICATED");
});

test("retired native authority remains usable; rollback hold and corrupted state deny access",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,p=profile(a.personId);await s.store.create(a,p,"create",3);
 await s.authority.advance(a,{action:"retire_sheet",proof:proof(3,1),operationId:"retire"});
 expect(await s.store.list(a,{...query,personId:p.personId},4)).toMatchObject({total:1});
 expect(await s.store.update(a,{...p,notes:"Synthetic retired native note"},1,"retired-update",4)).toEqual({version:2,replayed:false});
 // Corrupted authority must not leak the existing profile through any fallback.
 await s.f.pool.query("UPDATE ls_contact_ops.cutover SET state_ciphertext='invalid-cipher' WHERE workspace_id=$1",[a.workspaceId]);
 await expect(s.store.list(a,query,4)).rejects.toThrow("UNAVAILABLE");
 await expect(s.store.read(a,p.personId,4)).rejects.toThrow("UNAVAILABLE");
 const held=await setup();await activate(held);await held.authority.advance(held.f.practitioner.actor,{action:"prepare_rollback",proof:proof(3),operationId:"hold"});
 await expect(held.store.list(held.f.practitioner.actor,query,4)).rejects.toThrow("CONFLICT");
});

const contactFields={name:"Synthetic new contact — עברית",phone:"053-555-0187",language:"he" as const,source:"Synthetic owner entry",
 notes:"  Synthetic original administrative note\nעברית / English\n  ",nextAction:"Synthetic follow up",dueDate:"2026-09-28"};
async function contactCounts(s:Awaited<ReturnType<typeof setup>>){return (await s.f.pool.query(`SELECT
 (SELECT count(*)::int FROM ls_identity.people WHERE workspace_id=$1) AS people,
 (SELECT count(*)::int FROM ls_identity.accounts WHERE workspace_id=$1) AS accounts,
 (SELECT count(*)::int FROM ls_identity.account_subjects WHERE workspace_id=$1) AS subjects,
 (SELECT count(*)::int FROM ls_cases.cases WHERE workspace_id=$1) AS cases,
 (SELECT count(*)::int FROM ls_cases.case_guardians WHERE workspace_id=$1) AS guardians,
 (SELECT count(*)::int FROM ls_contact_ops.profiles WHERE workspace_id=$1) AS profiles,
 (SELECT count(*)::int FROM ls_contact_ops.legacy_links WHERE workspace_id=$1) AS links,
 (SELECT count(*)::int FROM ls_contact_ops.command_receipts WHERE workspace_id=$1) AS receipts`,[s.f.workspaceId])).rows[0];}

test("native manual creation commits one canonical encrypted contact, honest origin and no account/case grants",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,before=await contactCounts(s),operation=randomUUID();
 const created=await s.store.createContact(a,contactFields,operation,3);
 expect(created).toMatchObject({leadId:"LS-LEAD-native-"+created.personId,version:1,replayed:false});
 expect(await contactCounts(s)).toEqual({...before,people:before.people+1,profiles:1,receipts:2});
 const current=await s.store.read(a,created.personId,3);
 expect(current).toMatchObject({version:1,profile:{personId:created.personId,legacyIds:[],notes:contactFields.notes,
  nativeInquiry:{origin:"native_manual",leadId:created.leadId,phone:"+972535550187",language:"he",source:contactFields.source}}});
 const selected=await s.store.list(a,{...query,personId:created.personId},3);
 expect(selected.items[0]).toMatchObject({displayName:contactFields.name,references:[{leadId:created.leadId,nativeOrigin:"native_manual",
  sourceFileId:null,sourceSheetId:null,sourceRevision:null,phone:"+972535550187",paymentClaim:"",bookingClaim:"",formSentClaim:"",formSubmittedClaim:"",
  journey:{journeyState:"prospect",paymentVerified:false,bookingConfirmed:false}}]});
 const prospects=await s.store.prospects(a,3);expect(prospects).toHaveLength(1);
 expect(prospects[0]).toMatchObject({leadId:created.leadId,phone:"+972535550187",name:contactFields.name,notes:contactFields.notes,caseId:"",
  paymentVerified:false,bookingConfirmed:false,nativeEdit:{personId:created.personId,profileVersion:1,authorityEpoch:3}});
 expect(prospects[0]!.receivedAt).toBe(current!.profile.nativeInquiry!.createdAt);
 const stored=(await s.f.pool.query("SELECT p.payload_ciphertext,i.profile_ciphertext FROM ls_contact_ops.profiles p JOIN ls_identity.people i ON i.workspace_id=p.workspace_id AND i.id=p.person_id WHERE p.workspace_id=$1 AND p.person_id=$2",[a.workspaceId,created.personId])).rows[0];
 for(const value of Object.values(stored))for(const secret of [contactFields.notes,contactFields.name,"+972535550187"])expect(value).not.toContain(secret);
});

test("native create replay after a later note edit returns the original result without overwriting notes",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,operation=randomUUID(),created=await s.store.createContact(a,contactFields,operation,3);
 const notes="Synthetic later notes must survive create replay";
 await s.store.updateFields(a,created.personId,{stage:"Contacted",nextAction:"Synthetic later action",followUpDate:null,notes},1,"synthetic-after-create",3);
 const before=await contactCounts(s);expect(await s.store.createContact(a,contactFields,operation,3)).toEqual({...created,replayed:true});
 expect(await contactCounts(s)).toEqual(before);expect(await s.store.read(a,created.personId,3)).toMatchObject({version:2,profile:{notes,nextAction:"Synthetic later action"}});
 await expect(s.store.createContact(a,{...contactFields,notes:"Different input"},operation,3)).rejects.toThrow("CONFLICT");
 expect(await contactCounts(s)).toEqual(before);
 const update=await s.store.updateProspectFields(a,created.leadId,{owner:"Synthetic owner",outcome:"Synthetic recorded outcome"},2,randomUUID(),3);
 expect(update).toMatchObject({personId:created.personId,version:3,replayed:false});
 expect((await s.store.prospects(a,3))[0]).toMatchObject({notes,owner:"Synthetic owner",outcome:"Synthetic recorded outcome"});
});

test("concurrent exact native create replay is one contact; a separate normalized endpoint claim fails closed",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,operation=randomUUID();
 const created=await Promise.all([s.store.createContact(a,contactFields,operation,3),s.store.createContact(a,contactFields,operation,3)]);
 expect(new Set(created.map(r=>r.personId)).size).toBe(1);expect(created.map(r=>r.replayed).sort()).toEqual([false,true]);
 const before=await contactCounts(s);
 await expect(s.store.createContact(a,{...contactFields,name:"Synthetic different person",phone:"+972535550187",notes:"Must not overwrite"},randomUUID(),3)).rejects.toThrow("CONFLICT");
 expect(await contactCounts(s)).toEqual(before);expect((await s.store.read(a,created[0]!.personId,3))!.profile.notes).toBe(contactFields.notes);
 expect((await s.authority.read(a)).nativeWritesSinceSwitch).toBe(2);
});

test("counter save failure rolls back canonical contact, profile and both receipts atomically",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,before=await contactCounts(s),operation=randomUUID();
 const failing:IdentityStore={transaction:work=>s.db.transaction(tx=>work({query:async<T extends object>(sql:string,v?:readonly unknown[])=>{
  if(sql.startsWith("INSERT INTO ls_contact_ops.cutover("))throw Error("SYNTHETIC_CREATE_COUNTER_FAILURE");return tx.query<T>(sql,v);
 }}))};
 await expect(new OperationalNativeCrmStore(failing,s.f.keyring,key).createContact(a,contactFields,operation,3)).rejects.toThrow("SYNTHETIC_CREATE_COUNTER_FAILURE");
 expect(await contactCounts(s)).toEqual(before);expect((await s.authority.read(a)).nativeWritesSinceSwitch).toBe(0);
 expect(await s.store.createContact(a,contactFields,operation,3)).toMatchObject({version:1,replayed:false});
});

test("native contact creation denies pre-cutover/frozen/stale and actual current customer roles/revoked sessions",async()=>{
 const s=await setup(),a=s.f.practitioner.actor,before=await contactCounts(s);
 for(const epoch of [0,1,2]){
  await expect(s.store.createContact(a,contactFields,randomUUID(),epoch)).rejects.toThrow("CONFLICT");
  if(epoch<2)await s.authority.advance(a,{action:epoch===0?"prepare":"freeze",proof:proof(epoch),operationId:"creation-phase-"+epoch});
 }
 await s.authority.advance(a,{action:"switch_native",proof:proof(2),operationId:"creation-switch"});
 await expect(s.store.createContact(a,contactFields,randomUUID(),2)).rejects.toThrow("CONFLICT");
 for(const role of ["parent","child","adult_client"]){
  // Synthetic fixture changes only: the service must use the persisted role,
  // not a client-selected role or the previously cached parent actor object.
  await s.f.pool.query("UPDATE ls_identity.accounts SET role=$3 WHERE workspace_id=$1 AND id=$2",[a.workspaceId,s.f.parent.actor.id,role]);
  await expect(s.store.createContact(s.f.parent.actor,contactFields,randomUUID(),3)).rejects.toThrow("FORBIDDEN");
 }
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[a.sessionDigest]);
 await expect(s.store.createContact(a,contactFields,randomUUID(),3)).rejects.toThrow("UNAUTHENTICATED");
 expect(await contactCounts(s)).toEqual(before);
});

test("native inquiry origin/endpoint is immutable during administrative edits and cannot invent legacy provenance",async()=>{
 const s=await setup();await activate(s);const a=s.f.practitioner.actor,created=await s.store.createContact(a,contactFields,randomUUID(),3),saved=(await s.store.read(a,created.personId,3))!;
 const low=new NativeCrmStore(s.db,s.f.keyring,key),before=await contactCounts(s);
 await expect(low.update(a,{...saved.profile,nativeInquiry:{...saved.profile.nativeInquiry!,phone:"+972535550188"}},1,"synthetic-forged-endpoint")).rejects.toThrow("INQUIRY_ORIGIN_IMMUTABLE");
 const {nativeInquiry:_origin,...withoutOrigin}=saved.profile;
 expect(_origin?.origin).toBe("native_manual");
 await expect(low.update(a,withoutOrigin,1,"synthetic-dropped-origin")).rejects.toThrow("INQUIRY_ORIGIN_IMMUTABLE");
 await expect(low.update(a,{...saved.profile,nativeInquiry:{...saved.profile.nativeInquiry!,leadId:"LS-LEAD-native-"+randomUUID()}},1,"synthetic-forged-reference")).rejects.toThrow("BAD_PROFILE");
 expect(await contactCounts(s)).toEqual(before);expect((await s.store.read(a,created.personId,3))!.profile).toEqual(saved.profile);
});
