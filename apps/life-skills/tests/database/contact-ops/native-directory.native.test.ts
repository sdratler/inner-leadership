import {afterAll,expect,test,vi} from "vitest";
import {randomUUID,randomBytes,createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore} from "../calendar/fixture.ts";
import {NativeContactDirectory} from "../../../src/features/contact-ops/server/native-directory.ts";
import {NativeCrmStore,crmProfileAad,type CrmProfile} from "../../../src/features/contact-ops/server/native-store.ts";
import {seal} from "../../../src/features/identity/crypto.ts";
import type {IdentityStore,SqlSession} from "../../../src/features/identity/store.ts";

const f=await fixture({demoFirst:true});
afterAll(async()=>{await f.pool.end();});
const store=poolStore(f.pool),directory=new NativeContactDirectory(store,f.keyring);
const native=new NativeCrmStore(store,f.keyring,"synthetic-native-read-integrity-key-20260928");
const q={view:"all" as const,search:"",today:"2026-09-28",page:1,pageSize:20};
const sourceFileId="synthetic-complete-workbook",sourceSheetId=5;
const rows:Array<{id:string;lead:string;profile:CrmProfile}>=[];
for(let i=0;i<101;i++){
 const id=randomUUID(),lead=`LS-LEAD-native-${i}-${randomBytes(4).toString("hex")}`;
 const profile:CrmProfile={personId:id,stage:"new",nextAction:"Synthetic follow up",followUpDate:"2026-09-28",notes:"Synthetic preserved native note",legacyIds:[lead]};
 await f.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,clock_timestamp())",
  [id,f.workspaceId,seal(JSON.stringify({displayName:`Synthetic native ${i}`}),`person:${f.workspaceId}:${id}`,f.keyring)]);
 await native.create(f.practitioner.actor,profile,"create-native-"+id);
 await link(id,lead);
 rows.push({id,lead,profile});
}
const tail=[...rows].sort((a,b)=>a.id.localeCompare(b.id)).at(-1)!;
await f.pool.query("UPDATE ls_identity.people SET profile_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,tail.id,
 seal(JSON.stringify({displayName:"Synthetic searchable beyond first page"}),`person:${f.workspaceId}:${tail.id}`,f.keyring)]);

async function link(personId:string,lead:string){
 const payload={displayName:"Synthetic historic name",language:"he",stageText:"PAID",sourceFields:{
  "Lead ID":lead,"Parent/adult name":"Synthetic historic name","Phone":"+972520000001",
  "Email":"synthetic+native@example.invalid","Pipeline stage":"PAID","Payment status":"PAID",
  "Booking status":"Confirmed","General sales notes":"Synthetic preserved source note","Private unmapped field":"Never serialize this history field"}};
 await f.pool.query(`INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext)
  VALUES($1,$2,$3,'Synthetic Leads',$4,$5,'synthetic-revision',$6,$7)`,[f.workspaceId,sourceFileId,sourceSheetId,lead,personId,
  createHash("sha256").update(lead).digest("hex"),seal(JSON.stringify({sourceRow:2,payload}),`ls_contact_ops/legacy/v1/${f.workspaceId}/${sourceFileId}/${sourceSheetId}/${lead}`,f.keyring)]);
}

test("native PostgreSQL reads all keyset pages, searches after page one, and preserves encrypted notes",async()=>{
 const result=await directory.list(f.practitioner.actor,{...q,search:"beyond first page"});
 expect(result).toMatchObject({total:1,page:1,pages:1,items:[{personId:tail.id,version:1,notes:tail.profile.notes}]});
 expect(result.items[0]?.references[0]).toMatchObject({leadId:tail.lead,paymentClaim:"PAID",bookingClaim:"Confirmed",journey:{paymentVerified:false,bookingConfirmed:false,journeyState:"prospect"}});
 expect(JSON.stringify(result)).not.toContain("Never serialize this history field");
 expect(await directory.list(f.practitioner.actor,q)).toMatchObject({total:101,pages:6});
 expect((await directory.list(f.practitioner.actor,{...q,view:"paid"})).total).toBe(0);
 const changed={...tail.profile,notes:"Synthetic revised note preserved after reload",nextAction:"Synthetic new next action"};
 await native.update(f.practitioner.actor,changed,1,"native-edit-"+tail.id);
 expect((await directory.list(f.practitioner.actor,{...q,search:tail.lead})).items[0]).toMatchObject({version:2,notes:changed.notes,nextAction:changed.nextAction});
 const encrypted=await f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,tail.id]);
 expect(encrypted.rows[0].payload_ciphertext).not.toContain(changed.notes);
 const original=await f.pool.query("SELECT source_revision FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,tail.id]);
 expect(original.rows[0].source_revision).toBe("synthetic-revision");
});

test("native PostgreSQL uses one repeatable read snapshot across keyset pages and actual journey queries",async()=>{
 const before=await native.read(f.practitioner.actor,tail.id);
 if(!before)throw new Error("SYNTHETIC_PROFILE_MISSING");
 let changed=false;
 const concurrent:IdentityStore={transaction:work=>store.transaction(tx=>work({query:async<T extends object>(sql:string,values?:readonly unknown[])=>{
  const result=await tx.query<T>(sql,values);
  if(!changed&&sql.includes("FROM ls_contact_ops.profiles p")){
   changed=true;
   await native.update(f.practitioner.actor,{...before.profile,notes:"Synthetic concurrent later-page edit"},before.version,"concurrent-native-"+randomUUID());
  }
  return result;
 }} as SqlSession))};
 const snapshot=await new NativeContactDirectory(concurrent,f.keyring).list(f.practitioner.actor,{...q,search:tail.lead});
 expect(changed).toBe(true);
 expect(snapshot.items[0]).toMatchObject({version:before.version,notes:before.profile.notes});
 expect((await directory.list(f.practitioner.actor,{...q,search:tail.lead})).items[0]).toMatchObject({version:before.version+1,notes:"Synthetic concurrent later-page edit"});
});

test("native PostgreSQL fails closed on parent role, revoked session, cross-workspace, mismatched source/profile and ciphertext",async()=>{
 await expect(directory.list(f.parent.actor,q)).rejects.toThrow("FORBIDDEN");
 await expect(directory.list({...f.practitioner.actor,workspaceId:randomUUID() as typeof f.workspaceId},q)).rejects.toThrow("UNAUTHENTICATED");
 const revoked=await f.pool.connect();
 try{
  await revoked.query("BEGIN");
  await revoked.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[f.practitioner.actor.sessionDigest]);
  await revoked.query("COMMIT");
  await expect(directory.list(f.practitioner.actor,q)).rejects.toThrow("UNAUTHENTICATED");
 }finally{
  await revoked.query("UPDATE ls_identity.sessions SET revoked_at=NULL WHERE token_digest=$1",[f.practitioner.actor.sessionDigest]);
  revoked.release();
 }
 const original=(await f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,tail.id])).rows[0].payload_ciphertext;
 try{
  await f.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,tail.id,seal(JSON.stringify({...tail.profile,legacyIds:[]}),crmProfileAad(f.workspaceId,tail.id),f.keyring)]);
  await expect(directory.list(f.practitioner.actor,q)).rejects.toThrow("UNAVAILABLE");
  await f.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext='not-an-envelope' WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,tail.id]);
  await expect(directory.list(f.practitioner.actor,q)).rejects.toThrow("UNAVAILABLE");
 }finally{await f.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,tail.id,original]);}
});

test("native PostgreSQL keeps explicit demo mode separate from the live directory",async()=>{
 const personId=f.parent.actor.personId;
 await f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,'ls-owner-20260925','person',$2,$3,$4)",[f.workspaceId,personId,"native-read-demo-"+randomUUID(),f.parent.actor.id]);
 await native.create(f.practitioner.actor,{personId,stage:"new",nextAction:null,followUpDate:null,notes:"Synthetic demo note",legacyIds:[]},"create-demo-read-"+randomUUID());
 expect((await directory.list(f.practitioner.actor,q)).total).toBe(101);
 expect(await directory.list(f.practitioner.actor,{...q,mode:"demo"})).toMatchObject({total:1,items:[{personId,mode:"demo",displayName:"DEMO — Synthetic parent A"}]});
});

test("native PostgreSQL reads each actual payment allocation and booked appointment separately",async()=>{
 const subject=rows[0]!,secondLead="LS-LEAD-second-"+randomBytes(4).toString("hex");
 const current=await native.read(f.practitioner.actor,subject.id);
 if(!current)throw new Error("SYNTHETIC_PROFILE_MISSING");
 await native.update(f.practitioner.actor,{...current.profile,legacyIds:[subject.lead,secondLead]},current.version,"native-second-link-"+randomUUID());
 await link(subject.id,secondLead);
 const booking=await f.seed(f.at(10)),cases=[f.first,f.second],leads=[subject.lead,secondLead],allocations:string[]=[];
 for(let i=0;i<2;i++){
  const invitation=randomUUID(),receipt=randomUUID(),order="synthetic-native-order-"+randomUUID(),transaction="synthetic-transaction-"+randomUUID();
  const child=(await f.pool.query("SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.workspace_id=$1 AND c.id=$2",[f.workspaceId,cases[i]!.id])).rows[0].person_id;
  await f.pool.query(`INSERT INTO ls_intake.pre_enrollment_invitations(workspace_id,invitation_id,token_digest,stable_lead_ref,child_slots,expires_at,created_at,created_by_account_id)
   VALUES($1,$2,$3,$4,'["synthetic-slot"]'::jsonb,clock_timestamp()+interval '1 day',clock_timestamp(),$5)`,[f.workspaceId,invitation,createHash("sha256").update(invitation).digest("hex"),leads[i],f.practitioner.actor.id]);
  await f.pool.query(`INSERT INTO ls_intake.pre_enrollment_receipts(workspace_id,receipt_id,invitation_id,idempotency_key,payload_ciphertext,payload_digest,consent_version,consent_hash,received_at)
   VALUES($1,$2,$3,$4,'synthetic-unused-intake-ciphertext',$5,'synthetic-consent',$5,clock_timestamp())`,[f.workspaceId,receipt,invitation,randomUUID(),"a".repeat(64)]);
  await f.pool.query("INSERT INTO ls_onboarding.first_session_orders(workspace_id,order_id,case_id,child_id,amount_minor,currency,purpose) VALUES($1,$2,$3,$4,55000,'ILS','first_session')",[f.workspaceId,order,cases[i]!.id,child]);
  await f.pool.query("INSERT INTO ls_onboarding.payment_allocations(workspace_id,provider_account_id,transaction_id,order_id,child_id,amount_minor) VALUES($1,'synthetic-provider',$2,$3,$4,55000)",[f.workspaceId,transaction,order,child]);
  await f.pool.query(`INSERT INTO ls_onboarding.prospect_journeys(workspace_id,stable_lead_ref,intake_receipt_id,first_session_order_id,confirmed_appointment_id,state,created_at,updated_at)
   VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),clock_timestamp())`,[f.workspaceId,leads[i],receipt,order,i===0?booking:null,i===0?"active":"awaiting_booking"]);
  allocations.push(transaction);
 }
 const actual=(await directory.list(f.practitioner.actor,{...q,search:subject.lead})).items[0]!;
 expect(actual.references.find(r=>r.leadId===subject.lead)?.journey).toMatchObject({paymentVerified:true,bookingConfirmed:true,journeyState:"active"});
 expect(actual.references.find(r=>r.leadId===secondLead)?.journey).toMatchObject({paymentVerified:true,bookingConfirmed:false,journeyState:"awaiting_booking"});
 expect((await directory.list(f.practitioner.actor,{...q,search:subject.lead,view:"paid"})).total).toBe(1);
 await f.pool.query("INSERT INTO ls_onboarding.payment_reversals(workspace_id,provider_account_id,transaction_id) VALUES($1,'synthetic-provider',$2)",[f.workspaceId,allocations[1]]);
 expect((await directory.list(f.practitioner.actor,{...q,search:subject.lead,view:"paid"})).total).toBe(0);
 expect((await directory.list(f.practitioner.actor,{...q,search:subject.lead,view:"active"})).total).toBe(1);
});
