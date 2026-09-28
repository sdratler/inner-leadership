import {afterAll,beforeAll,expect,test,vi} from "vitest";
import {randomUUID,createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,safeTestUrl,type Fixture} from "../calendar/fixture.ts";
import {drizzleIdentityStore} from "../../../src/features/identity/drizzle-store.ts";
import {closeDatabase} from "../../../src/db/client.ts";
import {seal} from "../../../src/features/identity/crypto.ts";
import {NativeCrmStore,type CrmProfile} from "../../../src/features/contact-ops/server/native-store.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {authoritativeProspects} from "../../../src/features/contact-ops/server/authoritative-prospects.ts";

const key="synthetic-prospect-reader-integrity-key-20260928",source="synthetic-existing-workbook",sheet=5;
let f:Fixture,authority:ContactCutoverStore,native:OperationalNativeCrmStore;
const originals={url:process.env.LS_DATABASE_URL,tls:process.env.LS_DATABASE_TLS};
const profiles:Array<{profile:CrmProfile;lead:string}>=[];
// Explicitly synthetic prerequisites in a disposable local cluster. These
// booleans do NOT certify a production cutover and are never used by an operator.
const proof=(epoch:number,writes=0):CutoverEvidence=>({batchId:"synthetic-prospect-read",sourceFileId:source,sourceRevision:"synthetic-revision",
 expectedEpoch:epoch,observedNativeWritesSinceSwitch:writes,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,
 identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,
 nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
const legacy=vi.fn();
beforeAll(async()=>{
 f=await fixture({demoFirst:true});await closeDatabase();process.env.LS_DATABASE_URL=safeTestUrl();process.env.LS_DATABASE_TLS="disable";
 // SAME production binding adapter, not a fake SQL translator or raw-pg service.
 const db=drizzleIdentityStore,store=new NativeCrmStore(db,f.keyring,key);
 authority=new ContactCutoverStore(db,f.keyring,key);native=new OperationalNativeCrmStore(db,f.keyring,key);
 for(let i=0;i<101;i++){
  const personId=randomUUID(),lead=`LS-LEAD-reader-${i}`;
  const profile:CrmProfile={personId,legacyIds:[lead],stage:"New inquiry",nextAction:"Review \"quoted\" inquiry",followUpDate:"2026-09-28",notes:"Synthetic original administrative note"};
  await f.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,clock_timestamp())",
   [personId,f.workspaceId,seal(JSON.stringify({displayName:`Synthetic native reader ${i}`}),`person:${f.workspaceId}:${personId}`,f.keyring)]);
  await store.create(f.practitioner.actor,profile,"synthetic-read-create-"+i);
  const fields={"Lead ID":lead,"Parent/adult name":"Synthetic historical name","Date received":"2026-09-27T07:00:00Z","Phone":"+972520000001",
   "Email":"synthetic+reader@example.invalid","Language":"Hebrew","Lead source":"WhatsApp","Campaign":"Synthetic campaign","Last contact":"2026-09-28T08:00:00Z",
   "General sales notes":"Synthetic original source note","Outcome":"Synthetic follow-up","Enrolled case ID":f.second.id,"Form sent":"synthetic-form-sent",
   "Form submitted":"","Payment link sent":"synthetic-link-sent","Payment method":"Synthetic method","Payment status":"PAID","Payment allocation":"Synthetic claim only",
   "Booking status":"Confirmed claim only","Message receipt":"synthetic-receipt","Update provenance":"synthetic-source","First inbound at":"2026-09-27T07:00:00Z",
   "Last inbound at":"2026-09-28T08:00:00Z","Response owner":"Synthetic owner","Unmapped private field":"Never serialize this original history field"};
  await f.pool.query(`INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext)
   VALUES($1,$2,$3,'Synthetic Leads',$4,$5,'synthetic-revision',$6,$7)`,[f.workspaceId,source,sheet,lead,personId,createHash("sha256").update(lead).digest("hex"),
   seal(JSON.stringify({sourceRow:i+2,payload:{displayName:"Synthetic historical name",language:"Hebrew",stageText:"PAID",sourceFields:fields}}),`ls_contact_ops/legacy/v1/${f.workspaceId}/${source}/${sheet}/${lead}`,f.keyring)]);
  profiles.push({profile,lead});
 }
 for(const [i,action]of (["prepare","freeze","switch_native"] as const).entries())await authority.advance(f.practitioner.actor,{action,proof:proof(i),operationId:"synthetic-read-"+action});
},30000);
afterAll(async()=>{await closeDatabase();await f?.pool.end();
 if(originals.url===undefined)delete process.env.LS_DATABASE_URL;else process.env.LS_DATABASE_URL=originals.url;
 if(originals.tls===undefined)delete process.env.LS_DATABASE_TLS;else process.env.LS_DATABASE_TLS=originals.tls;
});
const read=()=>authoritativeProspects(f.practitioner.actor,{authority,native,sheet:{list:legacy}});

test("actual production adapter reads beyond page one, preserves current administrative fields and never promotes claims",async()=>{
 const rows=await read();expect(rows).toHaveLength(101);expect(new Set(rows.map(r=>r.leadId)).size).toBe(101);
 const tail=rows.find(r=>r.leadId===profiles[100]!.lead)!;
 expect(tail).toMatchObject({name:"Synthetic native reader 100",receivedAt:"2026-09-27T07:00:00Z",phone:"+972520000001",email:"synthetic+reader@example.invalid",
  stage:"New inquiry",nextAction:'Review "quoted" inquiry',notes:"Synthetic original administrative note",dueDate:"2026-09-28",owner:"Synthetic owner",caseId:"",
  paymentStatus:"PAID",paymentAllocation:"Synthetic claim only",bookingStatus:"Confirmed claim only",paymentVerified:false,bookingConfirmed:false,journeyState:"prospect"});
 expect(tail).toMatchObject({formSent:"synthetic-form-sent",paymentLinkSent:"synthetic-link-sent",messageReceipt:"synthetic-receipt",updateProvenance:"synthetic-source"});
 expect(JSON.stringify(rows)).not.toContain("Never serialize this original history field");expect(legacy).not.toHaveBeenCalled();
 expect((await authority.read(f.practitioner.actor)).nativeWritesSinceSwitch).toBe(0);
});
test("save/read/replay uses the same notes, source history and canonical authority without a provider effect",async()=>{
 const target=profiles[0]!,fields={stage:"Contacted",nextAction:"Synthetic follow-up tomorrow",followUpDate:"2026-09-29",notes:"Synthetic revised administrative note"};
 expect(await native.updateFields(f.practitioner.actor,target.profile.personId,fields,1,"synthetic-read-save",3)).toEqual({version:2,replayed:false});
 expect(await native.updateFields(f.practitioner.actor,target.profile.personId,fields,1,"synthetic-read-save",3)).toEqual({version:2,replayed:true});
 expect((await read()).find(r=>r.leadId===target.lead)).toMatchObject({stage:fields.stage,nextAction:fields.nextAction,dueDate:fields.followUpDate,notes:fields.notes});
 const stored=(await f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,target.profile.personId])).rows[0];
 expect(stored.payload_ciphertext).not.toContain(fields.notes);
 expect((await f.pool.query("SELECT source_revision FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND legacy_lead_id=$2",[f.workspaceId,target.lead])).rows[0].source_revision).toBe("synthetic-revision");
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);expect(legacy).not.toHaveBeenCalled();
});
test("canonical assignments survive absent or stale Sheet claims; multiple cases require the genuine same-person order",async()=>{
 const personId=(await f.pool.query("SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.workspace_id=$1 AND c.id=$2",[f.workspaceId,f.second.id])).rows[0].person_id;
 const lead="LS-LEAD-canonical-read-"+randomUUID(),profile:CrmProfile={personId,legacyIds:[lead],stage:"New inquiry",nextAction:"Synthetic assigned follow-up",followUpDate:"2026-09-28",notes:"Synthetic canonical client note"};
 // Seed ONLY this disposable fixture. No production import/create or case grant.
 await new NativeCrmStore(drizzleIdentityStore,f.keyring,key).create(f.practitioner.actor,profile,"synthetic-canonical-profile");
 const snapshot={sourceRow:2,payload:{displayName:"Synthetic canonical history",language:"he",stageText:"New inquiry",sourceFields:{"Lead ID":lead,"Enrolled case ID":""}}};
 const aad=`ls_contact_ops/legacy/v1/${f.workspaceId}/${source}/${sheet}/${lead}`;
 await f.pool.query(`INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext)
  VALUES($1,$2,$3,'Synthetic Leads',$4,$5,'synthetic-revision',$6,$7)`,[f.workspaceId,source,sheet,lead,personId,createHash("sha256").update(lead).digest("hex"),seal(JSON.stringify(snapshot),aad,f.keyring)]);
 expect((await read()).find(r=>r.leadId===lead)?.caseId).toBe(f.second.id);
 snapshot.payload.sourceFields["Enrolled case ID"]=f.first.id;
 await f.pool.query("UPDATE ls_contact_ops.legacy_links SET snapshot_ciphertext=$3 WHERE workspace_id=$1 AND legacy_lead_id=$2",[f.workspaceId,lead,seal(JSON.stringify(snapshot),aad,f.keyring)]);
 expect((await read()).find(r=>r.leadId===lead)?.caseId).toBe(f.second.id);
 const secondCase=randomUUID();
 await f.pool.query(`INSERT INTO ls_cases.cases(id,workspace_id,client_id,family_id,practitioner_account_id,state,created_at,updated_at)
  SELECT $3,workspace_id,client_id,family_id,practitioner_account_id,'intake',clock_timestamp(),clock_timestamp()
  FROM ls_cases.cases WHERE workspace_id=$1 AND id=$2`,[f.workspaceId,f.second.id,secondCase]);
 expect((await read()).find(r=>r.leadId===lead)?.caseId).toBe("");
 const order="synthetic-canonical-order-"+randomUUID();
 await f.pool.query("INSERT INTO ls_onboarding.first_session_orders(workspace_id,order_id,case_id,child_id,amount_minor,currency,purpose) VALUES($1,$2,$3,$4,55000,'ILS','first_session')",[f.workspaceId,order,secondCase,personId]);
 for(const stableLead of [lead,profiles[1]!.lead]){
  const invitation=randomUUID(),receipt=randomUUID();
  await f.pool.query(`INSERT INTO ls_intake.pre_enrollment_invitations(workspace_id,invitation_id,token_digest,stable_lead_ref,child_slots,expires_at,created_at,created_by_account_id)
   VALUES($1,$2,$3,$4,'["synthetic-slot"]'::jsonb,clock_timestamp()+interval '1 day',clock_timestamp(),$5)`,[f.workspaceId,invitation,createHash("sha256").update(invitation).digest("hex"),stableLead,f.practitioner.actor.id]);
  await f.pool.query(`INSERT INTO ls_intake.pre_enrollment_receipts(workspace_id,receipt_id,invitation_id,idempotency_key,payload_ciphertext,payload_digest,consent_version,consent_hash,received_at)
   VALUES($1,$2,$3,$4,'synthetic-unused-intake-ciphertext',$5,'synthetic-consent',$5,clock_timestamp())`,[f.workspaceId,receipt,invitation,randomUUID(),"a".repeat(64)]);
  await f.pool.query(`INSERT INTO ls_onboarding.prospect_journeys(workspace_id,stable_lead_ref,intake_receipt_id,first_session_order_id,state,created_at,updated_at)
   VALUES($1,$2,$3,$4,'awaiting_payment',clock_timestamp(),clock_timestamp())`,[f.workspaceId,stableLead,receipt,order]);
 }
 expect((await read()).find(r=>r.leadId===lead)).toMatchObject({caseId:secondCase,paymentVerified:false,bookingConfirmed:false});
 expect((await read()).find(r=>r.leadId===profiles[1]!.lead)?.caseId).toBe("");
 expect(legacy).not.toHaveBeenCalled();
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
});
test("stale epoch, other roles, revoked sessions and corrupt encrypted source deny rather than falling back",async()=>{
 await expect(native.prospects(f.practitioner.actor,2)).rejects.toMatchObject({code:"CONFLICT"});
 await expect(authoritativeProspects(f.parent.actor,{authority,native,sheet:{list:legacy}})).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(native.prospects(f.parent.actor,3)).rejects.toMatchObject({code:"FORBIDDEN"});
 const target=profiles[1]!,original=(await f.pool.query("SELECT snapshot_ciphertext FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND legacy_lead_id=$2",[f.workspaceId,target.lead])).rows[0].snapshot_ciphertext;
 try{await f.pool.query("UPDATE ls_contact_ops.legacy_links SET snapshot_ciphertext='synthetic-corrupt' WHERE workspace_id=$1 AND legacy_lead_id=$2",[f.workspaceId,target.lead]);
  await expect(read()).rejects.toMatchObject({code:"UNAVAILABLE"});expect(legacy).not.toHaveBeenCalled();
 }finally{await f.pool.query("UPDATE ls_contact_ops.legacy_links SET snapshot_ciphertext=$3 WHERE workspace_id=$1 AND legacy_lead_id=$2",[f.workspaceId,target.lead,original]);}
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[f.practitioner.actor.sessionDigest]);
 await expect(read()).rejects.toMatchObject({code:"UNAUTHENTICATED"});expect(legacy).not.toHaveBeenCalled();
});
