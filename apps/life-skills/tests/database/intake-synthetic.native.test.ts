import {createHash,randomUUID} from "node:crypto";
import {afterAll,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "./calendar/fixture.ts";
import {PreEnrollmentService} from "../../src/features/forms/pre-enrollment/service.ts";
import {PreEnrollmentStaffService} from "../../src/features/forms/pre-enrollment/staff.ts";
import {SqlPreEnrollmentRepository} from "../../src/features/forms/pre-enrollment/repository.ts";
import {publicConsentHash} from "../../src/features/forms/pre-enrollment/consent.ts";
import {issueSyntheticIntake,revokeSyntheticIntake} from "../../src/features/forms/pre-enrollment/synthetic-fixture.ts";
import {projectSubmittedIntake} from "../../src/features/forms/pre-enrollment/submission-projection.ts";
import type {IdentityStore} from "../../src/features/identity/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";

const fixtures:Fixture[]=[];
afterAll(async()=>{for(const f of fixtures)await f.pool.end();vi.unstubAllEnvs();});

const consent={version:"synthetic-native-intake-20261008",sourceHashes:["a".repeat(64),"b".repeat(64)],
 displayText:["Synthetic Hebrew consent paragraph."],acknowledgements:["One.","Two.","Three."],
 translations:{en:{displayText:["Synthetic English consent paragraph."],acknowledgements:["One.","Two.","Three."]}}};

function payload(slots:readonly string[],language:"he"|"en"="en"){
 return {parentName:"Synthetic Parent",contactNumber:"+15555550126",preferredLanguage:language,email:"parent@example.invalid",
  children:slots.map((childSlotId,index)=>({childSlotId,firstName:`Synthetic Child ${index+1}`,age:8})),locationPreference:"Synthetic park",
  arrivalNeeds:"Synthetic accessible entrance",availableDays:["sun"],timeWindows:["evening"],availabilityNote:"Synthetic evening preference",
  privateContext:"Synthetic private context",cp01:"not_now",willingToBeContacted:"yes",accessSupportNeeded:"no",
  consentVersion:consent.version,consentHash:publicConsentHash(consent),consentAcknowledgements:[true,true,true],consentLanguage:language,signerName:"Synthetic Signer"};
}

const effectTables=[
 "ls_calendar.availability","ls_calendar.appointments","ls_calendar.notices","ls_calendar.credit_exceptions","ls_calendar.events","ls_calendar.commands","ls_calendar.history","ls_calendar.tasks","ls_calendar.task_history",
 "ls_payments.charges","ls_payments.payments","ls_payments.allocations","ls_payments.credit_blocks","ls_payments.credit_events","ls_payments.refunds","ls_payments.calendar_receipts","ls_payments.commands",
 "ls_contact_ops.profiles","ls_contact_ops.legacy_links","ls_contact_ops.command_receipts","ls_contact_ops.cutover","ls_contact_ops.cutover_history","ls_contact_ops.message_receipts","ls_contact_ops.inbound_threads","ls_contact_ops.inbound_projections","ls_contact_ops.outbound_projections","ls_contact_ops.inbound_activity_candidates","ls_contact_ops.lead_promotion_operations","ls_contact_ops.acquisition_projection_status","ls_contact_ops.delta_operations","ls_contact_ops.delta_history",
] as const;
async function effects(f:Fixture){
 const result:Record<string,unknown>={};
 for(const table of effectTables)result[table]=(await f.pool.query<{rows:unknown}>(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t WHERE workspace_id=$1`,[f.workspaceId])).rows[0]!.rows;
 return result;
}
async function fixtureTuple(f:Fixture,operationId:string){
 const sourceKey="intake-fixture:v1:"+operationId;
 return (await f.pool.query(`SELECT
  to_jsonb(i)-'revoked_at' AS invitation,
  (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.receipt_id),'[]'::jsonb) FROM ls_intake.pre_enrollment_receipts r WHERE r.workspace_id=i.workspace_id AND r.invitation_id=i.invitation_id) AS receipts,
  (SELECT COALESCE(jsonb_agg(to_jsonb(m2) ORDER BY m2.entity_kind,m2.entity_key),'[]'::jsonb) FROM ls_demo.records m2 WHERE m2.workspace_id=i.workspace_id AND (m2.entity_key=i.invitation_id::text OR m2.source_key='intake-receipt:v1:'||i.invitation_id::text)) AS markers,
  (SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.stable_lead_ref),'[]'::jsonb) FROM ls_onboarding.prospect_journeys j WHERE j.workspace_id=i.workspace_id AND j.stable_lead_ref=i.stable_lead_ref) AS journeys
  FROM ls_demo.records m JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=m.workspace_id AND i.invitation_id::text=m.entity_key
  WHERE m.workspace_id=$1 AND m.entity_kind='form' AND m.source_key=$2`,[f.workspaceId,sourceKey])).rows[0];
}
/** Model the route's post-submit projection boundary. Revocation must reject in
 * the current service before any downstream projector can become reachable. */
async function submitThenProject(service:PreEnrollmentService,token:string,key:string,input:ReturnType<typeof payload>,project:(lead:string,fields:unknown)=>Promise<unknown>){
 const receipt=await service.submit(token,key,input);
 await project(receipt.stableLeadId,{formSubmitted:receipt.receivedAt,stage:"Intake submitted / awaiting payment",updateProvenance:"private-app:intake-submitted"});
 return receipt;
}

test("native PG synthetic fixture is replay-safe, encrypted, authorized and effect-free",async()=>{
 vi.stubEnv("LS_INTAKE_PUBLIC_CONSENT_JSON",JSON.stringify(consent));
 const f=await fixture({demoFirst:true});fixtures.push(f);
 const store=poolStore(f.pool),staff=new PreEnrollmentStaffService(store,f.keyring),binding={batch:"ls-owner-20260925",accountId:f.parent.actor.id};
 const baseline=await effects(f),operation=randomUUID(),key=Buffer.alloc(32,7);
 const issued=await issueSyntheticIntake(store,f.practitioner.actor,operation,binding,key,new Date());
 expect(await issueSyntheticIntake(store,f.practitioner.actor,operation,binding,key,new Date())).toEqual(expect.objectContaining({token:issued.token,replayed:true}));
 expect((await f.pool.query("SELECT invitation_id FROM ls_intake.pre_enrollment_invitations WHERE workspace_id=$1",[f.workspaceId])).rows).toHaveLength(1);
 await expect(issueSyntheticIntake(store,f.parent.actor,randomUUID(),binding,key,new Date())).rejects.toMatchObject({code:"FORBIDDEN"});

 const service=new PreEnrollmentService(new SqlPreEnrollmentRepository(store,f.workspaceId),f.keyring,()=>new Date(),true,f.workspaceId);
 const exchange=await service.exchange(issued.token);expect(exchange).toMatchObject({synthetic:true,bankTransfer:null});
 const idempotencyKey=randomUUID(),input=payload(exchange.childSlotIds,"en"),receipt=await service.submit(issued.token,idempotencyKey,input);
 expect(await service.submit(issued.token,idempotencyKey,input)).toMatchObject({receiptId:receipt.receiptId,duplicate:true});
 const history=await staff.history(f.practitioner.actor,receipt.receiptId);
 expect(history[0]).toMatchObject({synthetic:true,input:{...input,consentLanguage:"en",signerName:"Synthetic Signer",consentAcknowledgements:[true,true,true]},consent:{...consent,hash:publicConsentHash(consent)}});
 await expect(staff.history(f.parent.actor,receipt.receiptId)).rejects.toMatchObject({code:"FORBIDDEN"});
 expect((await staff.list(f.practitioner.actor)).find(item=>item.receiptId===receipt.receiptId)).toMatchObject({synthetic:true});

 const persisted=(await f.pool.query<{payload:string;consumedAt:Date|null;state:string}>(`SELECT r.payload_ciphertext AS payload,i.consumed_at AS "consumedAt",j.state
  FROM ls_intake.pre_enrollment_receipts r JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id
  JOIN ls_onboarding.prospect_journeys j ON j.workspace_id=i.workspace_id AND j.stable_lead_ref=i.stable_lead_ref
  WHERE r.workspace_id=$1 AND r.receipt_id=$2`,[f.workspaceId,receipt.receiptId])).rows[0]!;
 expect(persisted.payload).not.toContain("Synthetic Parent");expect(persisted.payload).not.toContain("Synthetic Child");
 expect(persisted.consumedAt).toBeInstanceOf(Date);expect(persisted.state).toBe("awaiting_payment");
 const project=vi.fn(async()=>false),requestId=randomUUID(),suppressedAt=new Date();
 expect(await projectSubmittedIntake(store,f.workspaceId,receipt,project,{requestId,now:suppressedAt})).toBe(false);expect(project).not.toHaveBeenCalled();
 const suppression=(await f.pool.query<{actor:string|null;request:string;action:string;occurredAt:Date}>(`SELECT actor_account_id AS actor,request_id AS request,action,occurred_at AS "occurredAt"
  FROM ls_identity.action_history WHERE workspace_id=$1 AND request_id=$2`,[f.workspaceId,requestId])).rows;
 expect(suppression).toHaveLength(1);expect(suppression[0]).toMatchObject({actor:null,request:requestId,occurredAt:suppressedAt});
 expect(JSON.parse(suppression[0]!.action)).toEqual({kind:"intake_projection_suppressed_before_bridge/v1",operationId:operation,receiptId:receipt.receiptId});
 expect(await effects(f)).toEqual(baseline);
});

test("native PG containment preserves a consumed fixture and blocks duplicate replay before projection",async()=>{
 vi.stubEnv("LS_INTAKE_PUBLIC_CONSENT_JSON",JSON.stringify(consent));
 const f=await fixture({demoFirst:true});fixtures.push(f);const store=poolStore(f.pool),binding={batch:"ls-owner-20260925",accountId:f.parent.actor.id};
 const operation=randomUUID(),keyMaterial=Buffer.alloc(32,11),issued=await issueSyntheticIntake(store,f.practitioner.actor,operation,binding,keyMaterial,new Date());
 const service=new PreEnrollmentService(new SqlPreEnrollmentRepository(store,f.workspaceId),f.keyring,()=>new Date(),true,f.workspaceId);
 const input=payload((await service.exchange(issued.token)).childSlotIds),idempotencyKey=randomUUID(),receipt=await service.submit(issued.token,idempotencyKey,input);
 const before=await fixtureTuple(f,operation),first=await revokeSyntheticIntake(store,f.practitioner.actor,operation,new Date());
 expect(first).toMatchObject({synthetic:true,replayed:false});
 const replay=await revokeSyntheticIntake(store,f.practitioner.actor,operation,new Date(Date.parse(first.revokedAt)+60_000));
 expect(replay).toEqual({...first,replayed:true});
 expect(await fixtureTuple(f,operation)).toEqual(before);
 await expect(service.exchange(issued.token)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(service.submit(issued.token,idempotencyKey,input)).rejects.toMatchObject({code:"NOT_FOUND"});
 const legacyProject=vi.fn(async()=>false);
 await expect(submitThenProject(service,issued.token,idempotencyKey,input,legacyProject)).rejects.toMatchObject({code:"NOT_FOUND"});
 expect(legacyProject).not.toHaveBeenCalled();
 await expect(issueSyntheticIntake(store,f.practitioner.actor,operation,binding,keyMaterial,new Date())).rejects.toMatchObject({code:"NOT_FOUND"});
 expect((await new PreEnrollmentStaffService(store,f.keyring).history(f.practitioner.actor,receipt.receiptId))[0]).toMatchObject({synthetic:true,input:{parentName:"Synthetic Parent"}});
});

test("native PG containment is operation-scoped, role-bound and leaves ordinary invitations untouched",async()=>{
 vi.stubEnv("LS_INTAKE_PUBLIC_CONSENT_JSON",JSON.stringify(consent));
 const f=await fixture({demoFirst:true});fixtures.push(f);const store=poolStore(f.pool),binding={batch:"ls-owner-20260925",accountId:f.parent.actor.id};
 const operation=randomUUID(),issued=await issueSyntheticIntake(store,f.practitioner.actor,operation,binding,Buffer.alloc(32,13),new Date());
 await expect(revokeSyntheticIntake(store,f.parent.actor,operation,new Date())).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(revokeSyntheticIntake(store,{...f.practitioner.actor,workspaceId:randomUUID() as Actor["workspaceId"]},operation,new Date())).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 await expect(revokeSyntheticIntake(store,f.practitioner.actor,randomUUID(),new Date())).rejects.toMatchObject({code:"NOT_FOUND"});
 const staff=new PreEnrollmentStaffService(store,f.keyring),ordinary=await staff.issue(f.practitioner.actor,"LS-LEAD-ordinary-containment",1);
 const ordinaryDigest=createHash("sha256").update(ordinary.token).digest("hex");
 await expect(revokeSyntheticIntake(store,f.practitioner.actor,randomUUID(),new Date())).rejects.toMatchObject({code:"NOT_FOUND"});
 const forgedOperation=randomUUID(),ordinaryId=(await f.pool.query<{id:string}>("SELECT invitation_id AS id FROM ls_intake.pre_enrollment_invitations WHERE workspace_id=$1 AND token_digest=$2",[f.workspaceId,ordinaryDigest])).rows[0]!.id;
 await f.pool.query(`INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,'ls-owner-20260925','form',$2,$3,$4)`,[f.workspaceId,ordinaryId,"intake-fixture:v1:"+forgedOperation,f.parent.actor.id]);
 await expect(revokeSyntheticIntake(store,f.practitioner.actor,forgedOperation,new Date())).rejects.toMatchObject({code:"UNAVAILABLE"});
 expect((await f.pool.query("SELECT revoked_at FROM ls_intake.pre_enrollment_invitations WHERE workspace_id=$1 AND token_digest=$2",[f.workspaceId,ordinaryDigest])).rows).toEqual([{revoked_at:null}]);
 await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.parent.actor.id]);
 await expect(revokeSyntheticIntake(store,f.practitioner.actor,operation,new Date())).rejects.toMatchObject({code:"FORBIDDEN"});
 const syntheticDigest=createHash("sha256").update(issued.token).digest("hex");
 expect((await f.pool.query("SELECT revoked_at FROM ls_intake.pre_enrollment_invitations WHERE workspace_id=$1 AND token_digest=$2",[f.workspaceId,syntheticDigest])).rows).toEqual([{revoked_at:null}]);
});

test("native PG concurrent submit and containment cannot leave a usable token after acknowledged revocation",async()=>{
 vi.stubEnv("LS_INTAKE_PUBLIC_CONSENT_JSON",JSON.stringify(consent));
 const f=await fixture({demoFirst:true});fixtures.push(f);const store=poolStore(f.pool),binding={batch:"ls-owner-20260925",accountId:f.parent.actor.id};
 const operation=randomUUID(),issued=await issueSyntheticIntake(store,f.practitioner.actor,operation,binding,Buffer.alloc(32,17),new Date());
 const service=new PreEnrollmentService(new SqlPreEnrollmentRepository(store,f.workspaceId),f.keyring,()=>new Date(),true,f.workspaceId),input=payload((await service.exchange(issued.token)).childSlotIds),idempotencyKey=randomUUID();
 const [contained,submitted]=await Promise.allSettled([revokeSyntheticIntake(store,f.practitioner.actor,operation,new Date()),service.submit(issued.token,idempotencyKey,input)]);
 expect(contained.status).toBe("fulfilled");
 expect(["fulfilled","rejected"]).toContain(submitted.status);
 await expect(service.exchange(issued.token)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(service.submit(issued.token,idempotencyKey,input)).rejects.toMatchObject({code:"NOT_FOUND"});
 const row=(await f.pool.query<{revokedAt:Date|null;receipts:number}>(`SELECT i.revoked_at AS "revokedAt",count(r.receipt_id)::int AS receipts FROM ls_intake.pre_enrollment_invitations i LEFT JOIN ls_intake.pre_enrollment_receipts r USING(workspace_id,invitation_id)
  WHERE i.workspace_id=$1 AND i.token_digest=$2 GROUP BY i.revoked_at`,[f.workspaceId,createHash("sha256").update(issued.token).digest("hex")])).rows[0]!;
 expect(row.revokedAt).toBeInstanceOf(Date);expect(row.receipts).toBe(submitted.status==="fulfilled"?1:0);
});

test("native PG rolls back an unmarked receipt and permits a clean retry",async()=>{
 vi.stubEnv("LS_INTAKE_PUBLIC_CONSENT_JSON",JSON.stringify(consent));
 const f=await fixture({demoFirst:true});fixtures.push(f);const store=poolStore(f.pool),binding={batch:"ls-owner-20260925",accountId:f.parent.actor.id};
 const issued=await issueSyntheticIntake(store,f.practitioner.actor,randomUUID(),binding,Buffer.alloc(32,9),new Date());
 const repository=new SqlPreEnrollmentRepository(store,f.workspaceId),slots=(await new PreEnrollmentService(repository,f.keyring,()=>new Date(),true,f.workspaceId).exchange(issued.token)).childSlotIds;
 const failingStore:IdentityStore={transaction:work=>store.transaction(tx=>work({query:async(sql,values)=>{if(sql.includes("INSERT INTO ls_demo.records")&&sql.includes("'submission'"))throw new Error("synthetic marker failure");return tx.query(sql,values);}}))};
 const failing=new PreEnrollmentService(new SqlPreEnrollmentRepository(failingStore,f.workspaceId),f.keyring,()=>new Date(),true,f.workspaceId);
 await expect(failing.submit(issued.token,randomUUID(),payload(slots))).rejects.toThrow("synthetic marker failure");
 const digest=createHash("sha256").update(issued.token).digest("hex");
 const rolledBack=(await f.pool.query<{receipts:number;consumedAt:Date|null;journeys:number}>(`SELECT
  (SELECT count(*)::int FROM ls_intake.pre_enrollment_receipts r JOIN ls_intake.pre_enrollment_invitations i USING(workspace_id,invitation_id) WHERE i.workspace_id=$1 AND i.token_digest=$2) AS receipts,
  (SELECT consumed_at FROM ls_intake.pre_enrollment_invitations WHERE workspace_id=$1 AND token_digest=$2) AS "consumedAt",
  (SELECT count(*)::int FROM ls_onboarding.prospect_journeys WHERE workspace_id=$1) AS journeys`,[f.workspaceId,digest])).rows[0]!;
 expect(rolledBack).toEqual({receipts:0,consumedAt:null,journeys:0});
 const service=new PreEnrollmentService(repository,f.keyring,()=>new Date(),true,f.workspaceId);
 await expect(service.submit(issued.token,randomUUID(),payload(slots))).resolves.toMatchObject({duplicate:false});
});

test("native PG projects an ordinary intake and refuses forged fixture provenance",async()=>{
 vi.stubEnv("LS_INTAKE_PUBLIC_CONSENT_JSON",JSON.stringify(consent));
 const f=await fixture({demoFirst:true});fixtures.push(f);const store=poolStore(f.pool),staff=new PreEnrollmentStaffService(store,f.keyring),service=new PreEnrollmentService(new SqlPreEnrollmentRepository(store,f.workspaceId),f.keyring,()=>new Date(),true,f.workspaceId);
 const issued=await staff.issue(f.practitioner.actor,"LS-LEAD-fixture-forged-name",1),exchange=await service.exchange(issued.token),receipt=await service.submit(issued.token,randomUUID(),payload(exchange.childSlotIds));
 const project=vi.fn(async()=>false);expect(await projectSubmittedIntake(store,f.workspaceId,receipt,project)).toBe(false);
 expect(project).toHaveBeenCalledExactlyOnceWith(receipt.stableLeadId,{formSubmitted:receipt.receivedAt,stage:"Intake submitted / awaiting payment",updateProvenance:"private-app:intake-submitted"});
 await f.pool.query(`INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,'ls-owner-20260925','submission',$2,'forged-receipt',$3)`,[f.workspaceId,receipt.receiptId,f.parent.actor.id]);
 await expect(projectSubmittedIntake(store,f.workspaceId,receipt,project)).rejects.toMatchObject({code:"UNAVAILABLE"});
 expect(project).toHaveBeenCalledTimes(1);
});
