import "server-only";
import type { IdentityStore, SqlSession } from "../../identity/store.ts";
import { blindEmail, seal, unseal, type Keyring } from "../../identity/crypto.ts";
import { freshActor, lockWorkspace } from "../../identity/data.ts";
import { demoAccountBatch } from "../../demo/provenance.ts";
import { systemClock, type Actor, type IdentityClock, type WorkspaceId } from "../../identity/types.ts";
import { requirePractitioner } from "../../cases/policy.ts";
import { normalizePhone } from "../core/contact-resolution.js";
import { canonical, requireThat } from "../core/validation.js";
import { importedFollowUpDate, planImport, type ImportRow, type SheetSnapshot } from "./import-plan.ts";
import { crmProfileAad, crmProfileSchema, type CrmProfile } from "./native-store.ts";
import {planSourceDelta, reconcileImportedProfile} from "./import-delta.ts";
import {readCutoverState,cutoverStateAad} from "./cutover-state.ts";
import {MAX_NATIVE_CONTACTS} from "../core/limits.ts";
import {privateDigest} from "./digests.ts";
import {z} from "zod";

export type NewPersonDisposition = { sourceRow: number; sourceRevision: string; legacyId: string; rowDigest: string; kind: "new_person" };
export type ShadowImportResult = { sourceRevision: string; planned: number; created: number; replayed: number };
export type ShadowPreflightResult = { sourceRevision: string; planned: number; wouldCreate: number; replayed: number };
export interface DeltaApplication {
 operationId:string;
 expectedEpoch:number;
 versions:readonly {legacyId:string;version:number}[];
 newPeople:readonly NewPersonDisposition[];
}
const deltaResultSchema=z.object({sourceRevision:z.string().min(1),previousRevision:z.string().min(1),
 authorityEpoch:z.number().int().positive().max(Number.MAX_SAFE_INTEGER-1),snapshotDigest:z.string().regex(/^[a-f0-9]{64}$/),planned:z.number().int().nonnegative(),
 created:z.number().int().nonnegative(),updated:z.number().int().nonnegative(),unchanged:z.number().int().nonnegative()}).strict();
const deltaOperationAad=(workspace:string,operation:string)=>`ls_contact_ops/delta-operation/v1/${workspace}/${operation}`;
const deltaHistoryAad=(workspace:string,operation:string,legacyId:string)=>`ls_contact_ops/delta-history/v1/${workspace}/${operation}/${legacyId}`;

const OPERATOR_PERMIT = Symbol("native-shadow-operator");
const EXACT_PROJECT = "3b756632-1f66-4f75-a016-eabc37aa0d67";
const EXACT_SERVICE = "0267d061-f3ce-4a0a-82d4-ce133e4501e9";
const EXACT_ENVIRONMENT = "dd91bd71-57cc-45e6-a75b-8c858491d7c7";

/** This separate one-shot path is unavailable to the Next server and HTTP routes. */
export function shadowOperatorAdmitted(env: Record<string, string | undefined>, entryPoint: string | undefined): boolean {
 return env.LS_NATIVE_SHADOW_IMPORT_APPROVED === "true" &&
  env.RAILWAY_PROJECT_ID === EXACT_PROJECT && env.RAILWAY_SERVICE_ID === EXACT_SERVICE &&
  env.RAILWAY_ENVIRONMENT_ID === EXACT_ENVIRONMENT &&
  /(?:^|[\\/])scripts[\\/]shadow-import-operator\.ts$/.test(entryPoint ?? "");
}

export function nativeShadowOperatorPermit(): symbol {
 if (!shadowOperatorAdmitted(process.env, process.argv[1])) throw new Error("IMPORT_OPERATOR_NOT_ADMITTED");
 return OPERATOR_PERMIT;
}

/** This service has no HTTP or provider entry point. A trusted operator must first
 * prove the full source revision and decide every row; it cannot fence the Sheet.
 */
export class NativeShadowImporter {
 constructor(
  private readonly db: IdentityStore,
  private readonly keyring: Keyring,
  private readonly lookupKey: Buffer,
  private readonly integrityKey: string,
  private readonly sourceFileId: string,
  private readonly sourceSheetId: number,
  private readonly clock: IdentityClock = systemClock,
 ) {
  requireThat(lookupKey.length === 32 && integrityKey.length >= 32, "IMPORT_KEYS_REQUIRED");
  requireThat(Boolean(sourceFileId) && Number.isSafeInteger(sourceSheetId) && sourceSheetId >= 0, "IMPORT_SOURCE_REQUIRED");
 }

 async importNewPeople(actor: Actor, snapshot: SheetSnapshot, dispositions: readonly NewPersonDisposition[]): Promise<ShadowImportResult> {
  return this.importAuthorized(actor.workspaceId, snapshot, dispositions, async tx => {
   requirePractitioner(await freshActor(tx, actor, this.clock.now()));
  });
 }

 /** Read-only preparation for the existing final-delta runbook. Every prior
  * encrypted row must match the supplied historical snapshot, not a row-count
  * assertion. The returned versions are observations, not an apply permit:
  * the eventual writer must recheck them under its authority/write locks.
  * No browser endpoint exposes this owner-private source material. */
 async preflightDelta(actor: Actor, previous: SheetSnapshot, next: SheetSnapshot) {
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
   const {updates,source,state,...result}=await this.inspectDelta(tx,actor,previous,next,false);
   // Keep decrypted merge material inside the service, not even its private
   // preflight output; stable IDs, versions, digests and conflict labels suffice.
   void updates;void state;
   return {...result,source:{previousRevision:source.previousRevision,nextRevision:source.nextRevision,
    previousSnapshotDigest:source.previousSnapshotDigest,nextSnapshotDigest:source.nextSnapshotDigest,
    ready:source.ready,missingLegacyIds:source.missingLegacyIds,review:source.review,
    rows:source.rows.map(row=>({kind:row.kind,legacyId:row.after.legacyId,sourceRow:row.after.sourceRow,rowDigest:row.after.rowDigest}))}};
  });
 }

 private async inspectDelta(tx:SqlSession,actor:Actor,previous:SheetSnapshot,next:SheetSnapshot,forUpdate:boolean){
  requireThat(previous.fileId === this.sourceFileId && previous.sheetId === this.sourceSheetId, "DELTA_SOURCE_MISMATCH");
  const delta = planSourceDelta(previous, next, actor.workspaceId, this.integrityKey);
  requireThat(delta.rows.length <= MAX_NATIVE_CONTACTS, "DELTA_DIRECTORY_BOUND");
  const oldPlan = planImport(previous, actor.workspaceId, this.integrityKey);
   requirePractitioner(await freshActor(tx, actor, this.clock.now()));
   const state = await readCutoverState(tx, actor.workspaceId, this.keyring, forUpdate);
   requireThat(["sheet_active", "shadow_ready", "frozen"].includes(state.phase) && state.nativeWritesSinceSwitch === 0,
    "DELTA_AUTHORITY_NOT_PRE_NATIVE");
   if(state.phase !== "sheet_active") requireThat(state.sourceFileId === previous.fileId &&
    state.sourceRevision === previous.revision, "DELTA_AUTHORITY_SOURCE_MISMATCH");
   const links = await tx.query<{legacyId:string;personId:string;rowDigest:string;sourceRevision:string;sourceTab:string;snapshotCiphertext:string;
    profileCiphertext:string;identityCiphertext:string;personKind:string;version:number;recordMode:string;demoBatchId:string|null;archivedAt:Date|null}>(
    `SELECT l.legacy_lead_id AS "legacyId",l.person_id AS "personId",l.row_digest AS "rowDigest",
     l.source_revision AS "sourceRevision",l.source_tab_title AS "sourceTab",l.snapshot_ciphertext AS "snapshotCiphertext",
     p.payload_ciphertext AS "profileCiphertext",i.profile_ciphertext AS "identityCiphertext",i.kind AS "personKind",
     p.version,p.record_mode AS "recordMode",p.demo_batch_id AS "demoBatchId",p.archived_at AS "archivedAt"
     FROM ls_contact_ops.legacy_links l JOIN ls_contact_ops.profiles p ON p.workspace_id=l.workspace_id AND p.person_id=l.person_id
     JOIN ls_identity.people i ON i.workspace_id=p.workspace_id AND i.id=p.person_id
     WHERE l.workspace_id=$1 AND l.source_file_id=$2 AND l.source_sheet_id=$3 LIMIT $4${forUpdate ? " FOR UPDATE OF l,p,i" : ""}`,
    [actor.workspaceId,previous.fileId,previous.sheetId,MAX_NATIVE_CONTACTS+1]);
   requireThat(links.length <= MAX_NATIVE_CONTACTS && links.length === oldPlan.rows.length &&
    new Set(links.map(link=>link.legacyId)).size === links.length, "DELTA_PRIOR_LINK_SET_MISMATCH");
   const unlinked=await tx.query(`SELECT p.person_id FROM ls_contact_ops.profiles p WHERE p.workspace_id=$1 AND p.record_mode='live'
    AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.legacy_links l WHERE l.workspace_id=p.workspace_id AND l.person_id=p.person_id
     AND l.source_file_id=$2 AND l.source_sheet_id=$3) LIMIT 1`,[actor.workspaceId,previous.fileId,previous.sheetId]);
   requireThat(unlinked.length===0,"DELTA_UNLINKED_NATIVE_PROFILE_REQUIRES_REVIEW");
   const current = new Map(links.map(link=>[link.legacyId,link]));
   const accounts = await tx.query<{id:string;personId:string|null;emailBlind:string;phoneCiphertext:string|null}>(
    `SELECT a.id,s.person_id AS "personId",a.email_blind AS "emailBlind",a.phone_ciphertext AS "phoneCiphertext"
     FROM ls_identity.accounts a LEFT JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
     WHERE a.workspace_id=$1 LIMIT $2`,[actor.workspaceId,MAX_NATIVE_CONTACTS+1]);
   requireThat(accounts.length <= MAX_NATIVE_CONTACTS,"DELTA_ACCOUNT_BOUND");
   const accountPhones=new Map<string,Set<string|null>>(),accountEmails=new Map<string,Set<string|null>>();
   for(const account of accounts){
    addOwner(accountEmails,account.emailBlind,account.personId);
    if(account.phoneCiphertext){
     const phone=normalizePhone(unseal(account.phoneCiphertext,`phone:${actor.workspaceId}:${account.id}`,this.keyring));
     requireThat(phone !== null,"DELTA_ACCOUNT_PHONE_INVALID");
     addOwner(accountPhones,phone,account.personId);
    }
   }
   const identityConflicts: {legacyId:string;reason:"ACCOUNT_ENDPOINT_COLLISION"}[]=[];
   for(const {after} of delta.rows){
    const personId=current.get(after.legacyId)?.personId;
    const owners=[after.normalizedPhone ? accountPhones.get(after.normalizedPhone) : undefined,
     after.normalizedEmail ? accountEmails.get(blindEmail(after.normalizedEmail,this.lookupKey)) : undefined];
    if(owners.some(set=>set && (!personId || [...set].some(owner=>owner!==personId))))
     identityConflicts.push({legacyId:after.legacyId,reason:"ACCOUNT_ENDPOINT_COLLISION"});
   }
   const incoming = new Map(delta.rows.map(row=>[row.after.legacyId,row]));
   const reviewIds = new Set(delta.review.map(row=>row.legacyId));
   const conflicts: {legacyId:string;fields:readonly string[]}[] = [];
   const existing = [];
   const updates = [];
   for(const before of oldPlan.rows) {
    const link = current.get(before.legacyId);
    requireThat(link && link.personId === before.suggestedPersonId && link.rowDigest === before.rowDigest &&
     link.sourceRevision === previous.revision && link.personKind === "adult" && link.recordMode === "live" && link.demoBatchId === null &&
     link.archivedAt === null && Number.isSafeInteger(link.version) && link.version > 0, "DELTA_PRIOR_BINDING_MISMATCH");
    const snapshot=JSON.parse(unseal(link.snapshotCiphertext,legacyAad(actor.workspaceId,previous,before.legacyId),this.keyring));
    requireThat(canonical(snapshot) === canonical({sourceRow:before.sourceRow,payload:before.protectedPayload}), "DELTA_PRIOR_CONTENT_MISMATCH");
    const profile=crmProfileSchema.parse(JSON.parse(unseal(link.profileCiphertext,crmProfileAad(actor.workspaceId,link.personId),this.keyring))) as CrmProfile;
    requireThat(profile.personId === link.personId, "DELTA_PRIOR_BINDING_MISMATCH");
    const identity=JSON.parse(unseal(link.identityCiphertext,`person:${actor.workspaceId}:${link.personId}`,this.keyring));
    requireThat(typeof identity?.displayName === "string", "DELTA_IDENTITY_CONTENT_INVALID");
    const item=incoming.get(before.legacyId);
    if(!item || reviewIds.has(before.legacyId)) continue;
    const merged=reconcileImportedProfile(before,item.after,profile), rowConflicts:string[]=[...merged.conflicts];
    const nameChanged=before.protectedPayload.displayName !== item.after.protectedPayload.displayName;
    if(nameChanged && identity.displayName !== before.protectedPayload.displayName && identity.displayName !== item.after.protectedPayload.displayName)
     rowConflicts.push("displayName");
    if(rowConflicts.length) conflicts.push({legacyId:before.legacyId,fields:rowConflicts});
    existing.push({legacyId:before.legacyId,personId:link.personId,expectedVersion:link.version,
     expectedRowDigest:link.rowDigest,sourceChanged:before.rowDigest!==item.after.rowDigest,
     profileChanged:merged.changed,conflicts:rowConflicts});
    updates.push({before,after:item.after,link,profile:merged.profile,
     identity:{...identity,displayName:nameChanged ? item.after.protectedPayload.displayName : identity.displayName},
     profileChanged:merged.changed,nameChanged:nameChanged && identity.displayName!==item.after.protectedPayload.displayName});
   }
   // New rows still need the existing explicit identity dispositions and live
   // account/endpoint-collision checks. This read cannot authorize their import.
   const newRows=delta.rows.filter(row=>row.kind === "new").map(row=>row.after.legacyId);
   return {source:delta,state,expectedEpoch:state.epoch,phase:state.phase,existing,updates,conflicts,identityConflicts,newRows,
    existingRowsReconciled:delta.ready && conflicts.length===0 && identityConflicts.length===0,
    newIdentityDecisionsRequired:newRows.length>0,effects:"none" as const};
 }

 /** Internal transaction only, deliberately no HTTP/CLI route. The release
  * operator must first establish the real external writer freeze/durable inbox
  * recorded by the cutover service. It advances the frozen epoch/revision with
  * an immutable delta receipt; it does not activate native authority or send.
  * Replays return the immutable operation result, not a new reconciliation. */
 async applyDelta(actor:Actor,previous:SheetSnapshot,next:SheetSnapshot,input:DeltaApplication){
  requireThat(/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId) && Number.isSafeInteger(input.expectedEpoch) &&
   input.expectedEpoch>=0 && input.expectedEpoch<Number.MAX_SAFE_INTEGER-1,"DELTA_APPLICATION_INVALID");
  requireThat(input.versions.length<=MAX_NATIVE_CONTACTS && input.newPeople.length<=MAX_NATIVE_CONTACTS,"DELTA_DIRECTORY_BOUND");
  const digest=privateDigest({actorId:actor.id,previous,next,input},this.integrityKey);
  return this.db.transaction(async tx=>{
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${actor.workspaceId}:contact-authority`]);
   await lockWorkspace(tx,actor.workspaceId);
   requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const prior=await tx.query<{digest:string;ciphertext:string}>(
    `SELECT payload_digest AS digest,result_ciphertext AS ciphertext FROM ls_contact_ops.delta_operations
     WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,input.operationId]);
   if(prior[0]){
    requireThat(prior[0].digest===digest,"DELTA_OPERATION_CONFLICT");
    return {...deltaResultSchema.parse(JSON.parse(unseal(prior[0].ciphertext,deltaOperationAad(actor.workspaceId,input.operationId),this.keyring))),replayed:true};
   }
   const plan=await this.inspectDelta(tx,actor,previous,next,true);
   requireThat(plan.phase==="frozen" && plan.expectedEpoch===input.expectedEpoch,"DELTA_REQUIRES_EXACT_FREEZE");
   requireThat(plan.existingRowsReconciled,"DELTA_RECONCILIATION_REQUIRED");
   const pending=await tx.query("SELECT operation_id FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND state IN ('prepared','sent_pending') LIMIT 1",[actor.workspaceId]);
   requireThat(pending.length===0,"DELTA_PENDING_OUTBOUND_RECONCILIATION");
   const versions=new Map(input.versions.map(item=>[item.legacyId,item.version]));
   requireThat(versions.size===input.versions.length && versions.size===plan.existing.length &&
    plan.existing.every(row=>versions.get(row.legacyId)===row.expectedVersion),"DELTA_VERSION_CONFLICT");
   const newRows=plan.source.rows.filter(row=>row.kind==="new").map(row=>row.after);
   const decisions=new Map(input.newPeople.map(item=>[item.legacyId,item]));
   requireThat(decisions.size===input.newPeople.length && decisions.size===newRows.length,"DELTA_DISPOSITION_INCOMPLETE");
   for(const row of newRows){
    const decision=decisions.get(row.legacyId);
    requireThat(decision?.kind==="new_person" && decision.sourceRow===row.sourceRow &&
     decision.sourceRevision===next.revision && decision.rowDigest===row.rowDigest,"DELTA_DISPOSITION_STALE");
    requireThat((await tx.query("SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,row.suggestedPersonId])).length===0,
     "IMPORT_PERSON_ID_COLLISION");
    profileFromRow(row); // Validate every new row before the first insert.
   }
   const changed=plan.updates.filter(row=>row.profileChanged||row.nameChanged).length;
   const nextAuthority={...plan.state,epoch:plan.state.epoch+1,sourceRevision:next.revision};
   const result=deltaResultSchema.parse({sourceRevision:next.revision,previousRevision:previous.revision,
    authorityEpoch:nextAuthority.epoch,snapshotDigest:plan.source.nextSnapshotDigest,planned:plan.source.rows.length,
    created:newRows.length,updated:changed,unchanged:plan.updates.length-changed});
   await tx.query(`INSERT INTO ls_contact_ops.delta_operations(workspace_id,operation_id,actor_account_id,authority_epoch,payload_digest,result_ciphertext)
    VALUES($1,$2,$3,$4,$5,$6)`,[actor.workspaceId,input.operationId,actor.id,input.expectedEpoch,digest,
    seal(JSON.stringify(result),deltaOperationAad(actor.workspaceId,input.operationId),this.keyring)]);
   for(const item of plan.updates){
    const {after,link}=item,changed=item.profileChanged||item.nameChanged;
    requireThat(link.version<2147483647,"DELTA_VERSION_EXHAUSTED");
    const profileCiphertext=changed ? seal(JSON.stringify(item.profile),crmProfileAad(actor.workspaceId,link.personId),this.keyring) : link.profileCiphertext;
    const identityCiphertext=item.nameChanged ? seal(JSON.stringify(item.identity),`person:${actor.workspaceId}:${link.personId}`,this.keyring) : link.identityCiphertext;
    const snapshotCiphertext=seal(JSON.stringify({sourceRow:after.sourceRow,payload:after.protectedPayload}),legacyAad(actor.workspaceId,next,after.legacyId),this.keyring);
    if(changed){
     const saved=await tx.query(`UPDATE ls_contact_ops.profiles SET payload_ciphertext=$4,version=version+1,updated_at=clock_timestamp()
      WHERE workspace_id=$1 AND person_id=$2 AND version=$3 RETURNING person_id`,[actor.workspaceId,link.personId,link.version,profileCiphertext]);
     requireThat(saved.length===1,"DELTA_VERSION_CONFLICT");
    }
    if(item.nameChanged)await tx.query("UPDATE ls_identity.people SET profile_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,link.personId,identityCiphertext]);
    await tx.query(`UPDATE ls_contact_ops.legacy_links SET source_revision=$5,row_digest=$6,snapshot_ciphertext=$7,source_tab_title=$8
     WHERE workspace_id=$1 AND source_file_id=$2 AND source_sheet_id=$3 AND legacy_lead_id=$4`,
     [actor.workspaceId,next.fileId,next.sheetId,after.legacyId,next.revision,after.rowDigest,snapshotCiphertext,next.tab]);
    await this.recordDeltaRow(tx,actor,input,after,{sourceFileId:next.fileId,sourceSheetId:next.sheetId,before:link,after:{sourceRevision:next.revision,rowDigest:after.rowDigest,
     sourceTab:next.tab,sourceRow:after.sourceRow,profileCiphertext,identityCiphertext,snapshotCiphertext,version:link.version+(changed?1:0)}});
   }
   for(const row of newRows){
    const profileCiphertext=seal(JSON.stringify(profileFromRow(row)),crmProfileAad(actor.workspaceId,row.suggestedPersonId),this.keyring);
    const identityCiphertext=seal(JSON.stringify({displayName:row.protectedPayload.displayName}),`person:${actor.workspaceId}:${row.suggestedPersonId}`,this.keyring);
    const snapshotCiphertext=seal(JSON.stringify({sourceRow:row.sourceRow,payload:row.protectedPayload}),legacyAad(actor.workspaceId,next,row.legacyId),this.keyring);
    await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",[row.suggestedPersonId,actor.workspaceId,identityCiphertext,this.clock.now()]);
    await tx.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,'live',NULL)",[actor.workspaceId,row.suggestedPersonId,profileCiphertext]);
    await tx.query(`INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[actor.workspaceId,next.fileId,next.sheetId,next.tab,row.legacyId,row.suggestedPersonId,next.revision,row.rowDigest,snapshotCiphertext]);
    await this.recordDeltaRow(tx,actor,input,row,{sourceFileId:next.fileId,sourceSheetId:next.sheetId,before:null,after:{sourceRevision:next.revision,rowDigest:row.rowDigest,
     sourceTab:next.tab,sourceRow:row.sourceRow,profileCiphertext,identityCiphertext,snapshotCiphertext,version:1}});
   }
   // Bind final snapshot r2 to the frozen authority in the SAME transaction as
   // its rows/history. All old r1/epoch proofs now fail the existing cutover gate.
   const advanced=await tx.query(`UPDATE ls_contact_ops.cutover SET epoch=$3,state_ciphertext=$4,updated_at=clock_timestamp()
    WHERE workspace_id=$1 AND epoch=$2 AND phase='frozen' RETURNING workspace_id`,
    [actor.workspaceId,input.expectedEpoch,nextAuthority.epoch,
     seal(JSON.stringify(nextAuthority),cutoverStateAad(actor.workspaceId,nextAuthority.epoch),this.keyring)]);
   requireThat(advanced.length===1,"DELTA_AUTHORITY_CHANGED");
   return {...result,replayed:false};
  });
 }

 private async recordDeltaRow(tx:SqlSession,actor:Actor,input:DeltaApplication,row:ImportRow,evidence:unknown){
  await tx.query(`INSERT INTO ls_contact_ops.delta_history(workspace_id,operation_id,legacy_lead_id,person_id,evidence_ciphertext)
   VALUES($1,$2,$3,$4,$5)`,[actor.workspaceId,input.operationId,row.legacyId,row.suggestedPersonId,
   seal(JSON.stringify(evidence),deltaHistoryAad(actor.workspaceId,input.operationId,row.legacyId),this.keyring)]);
 }

 /** Only the exact reviewed CLI may call this. It checks the real verified,
  * non-demo practitioner inside the same workspace-locked transaction; it does
  * not mint a browser session or grant a prospect account/case relationship.
  */
 async importNewPeopleAsOperator(workspaceId: WorkspaceId, snapshot: SheetSnapshot, dispositions: readonly NewPersonDisposition[], permit: symbol): Promise<ShadowImportResult> {
  if (permit !== OPERATOR_PERMIT || !shadowOperatorAdmitted(process.env, process.argv[1])) throw new Error("IMPORT_OPERATOR_NOT_ADMITTED");
  return this.importAuthorized(workspaceId, snapshot, dispositions, tx => this.authorizeOperator(tx, workspaceId));
 }

 async preflightNewPeopleAsOperator(workspaceId: WorkspaceId, snapshot: SheetSnapshot, dispositions: readonly NewPersonDisposition[], permit: symbol): Promise<ShadowPreflightResult> {
  if (permit !== OPERATOR_PERMIT || !shadowOperatorAdmitted(process.env, process.argv[1])) throw new Error("IMPORT_OPERATOR_NOT_ADMITTED");
  const result = await this.importAuthorized(workspaceId, snapshot, dispositions, tx => this.authorizeOperator(tx, workspaceId), false);
  return {sourceRevision:result.sourceRevision, planned:result.planned, wouldCreate:result.created, replayed:result.replayed};
 }

 private async authorizeOperator(tx: SqlSession, workspaceId: WorkspaceId): Promise<void> {
   const owners = await tx.query<{id:string;role:"practitioner";state:"active";emailVerifiedAt:Date|null;emailCiphertext:string;emailBlind:string}>(
    `SELECT id,role,state,email_verified_at AS "emailVerifiedAt",email_ciphertext AS "emailCiphertext",email_blind AS "emailBlind" FROM ls_identity.accounts
     WHERE workspace_id=$1 AND role='practitioner' AND state='active'`, [workspaceId]);
   requireThat(owners.length === 1 && Boolean(owners[0]?.emailVerifiedAt), "IMPORT_OPERATOR_ACCOUNT_REQUIRES_REVIEW");
   requireThat(await demoAccountBatch(tx, workspaceId, owners[0]!.id) === null, "IMPORT_DEMO_OPERATOR_FORBIDDEN");
   // Before any first import can write under these runtime keys, prove both the
   // active data key and lookup key against an existing verified account.
   try {
    const account=owners[0]!;
    const envelope=JSON.parse(account.emailCiphertext) as {kid?:unknown};
    requireThat(envelope.kid === this.keyring.activeKeyId, "IMPORT_OPERATOR_CRYPTO_KEYS_INVALID");
    const email=unseal(account.emailCiphertext,`email:${workspaceId}:${account.id}`,this.keyring);
    requireThat(blindEmail(email,this.lookupKey) === account.emailBlind, "IMPORT_OPERATOR_CRYPTO_KEYS_INVALID");
   } catch { throw new Error("IMPORT_OPERATOR_CRYPTO_KEYS_INVALID"); }
 }

 private async importAuthorized(workspaceId: WorkspaceId, snapshot: SheetSnapshot, dispositions: readonly NewPersonDisposition[], authorize: (tx: SqlSession) => Promise<void>, apply = true): Promise<ShadowImportResult> {
  requireThat(snapshot.fileId === this.sourceFileId && snapshot.sheetId === this.sourceSheetId, "IMPORT_SOURCE_MISMATCH");
  const plan = planImport(snapshot, workspaceId, this.integrityKey);
  requireThat(plan.canImport && plan.rows.length > 0 && plan.rows.every(row => row.issues.length === 0), "IMPORT_PLAN_NEEDS_REVIEW");
  const decisions = new Map<number, NewPersonDisposition>();
  for (const item of dispositions) {
   requireThat(item.kind === "new_person" && Number.isSafeInteger(item.sourceRow) && !decisions.has(item.sourceRow), "IMPORT_DISPOSITION_INVALID");
   decisions.set(item.sourceRow, item);
  }
  requireThat(decisions.size === plan.rows.length && plan.rows.every(row => decisions.has(row.sourceRow)), "IMPORT_DISPOSITION_INCOMPLETE");
  for (const row of plan.rows) {
   const decision = decisions.get(row.sourceRow)!;
   requireThat(decision.sourceRevision === snapshot.revision && decision.legacyId === row.legacyId && decision.rowDigest === row.rowDigest, "IMPORT_DISPOSITION_STALE");
  }
  const phones = new Set<string>(), emails = new Set<string>();
  for (const row of plan.rows) {
   importedFollowUpDate(row);
   if (row.normalizedPhone) {
    requireThat(!phones.has(row.normalizedPhone), "IMPORT_SHARED_ENDPOINT_REQUIRES_REVIEW");
    phones.add(row.normalizedPhone);
   }
   if (row.normalizedEmail) {
    const email = row.normalizedEmail.toLocaleLowerCase();
    requireThat(!emails.has(email), "IMPORT_SHARED_ENDPOINT_REQUIRES_REVIEW");
    emails.add(email);
   }
  }
  return this.db.transaction(async tx => {
   // Serialize with the same authority fence as operational writers. Initial
   // import must never mutate a prepared snapshot or race native activation.
   // Lock order matches authority -> identity used by native operations.
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${workspaceId}:contact-authority`]);
   // Identity mutations use this row lock. READ COMMITTED lets the account scan
   // see a mutation that committed while this transaction waited for the lock.
   await lockWorkspace(tx, workspaceId);
   await authorize(tx);
   const authority=await readCutoverState(tx,workspaceId,this.keyring,true);
   requireThat(authority.phase === "sheet_active" && authority.nativeWritesSinceSwitch === 0,
    "IMPORT_AUTHORITY_ALREADY_PREPARED");
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${workspaceId}:crm-import:${snapshot.fileId}:${snapshot.sheetId}`]);
   const links = await tx.query<{ legacyId: string; personId: string; rowDigest: string; sourceRevision: string; snapshotCiphertext: string }>(
    'SELECT legacy_lead_id AS "legacyId",person_id AS "personId",row_digest AS "rowDigest",source_revision AS "sourceRevision",snapshot_ciphertext AS "snapshotCiphertext" FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 AND source_sheet_id=$3',
    [workspaceId, snapshot.fileId, snapshot.sheetId],
   );
   const prior = new Map(links.map(link => [link.legacyId, link]));
   const plannedIds = new Set(plan.rows.map(row => row.legacyId));
   requireThat(prior.size === links.length && links.length <= plan.rows.length &&
    links.every(link => plannedIds.has(link.legacyId)), "IMPORT_EXISTING_LINK_SET_MISMATCH");
   const unrelatedProfiles = await tx.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM ls_contact_ops.profiles p
     WHERE p.workspace_id=$1 AND p.record_mode='live' AND NOT EXISTS(
      SELECT 1 FROM ls_contact_ops.legacy_links l
      WHERE l.workspace_id=p.workspace_id AND l.person_id=p.person_id
       AND l.source_file_id=$2 AND l.source_sheet_id=$3)`,
    [workspaceId, snapshot.fileId, snapshot.sheetId],
   );
   requireThat(unrelatedProfiles.length === 1 && unrelatedProfiles[0]!.n === 0, "IMPORT_UNLINKED_NATIVE_PROFILE_REQUIRES_REVIEW");
   const accounts = await tx.query<{ id: string; personId: string | null; emailBlind: string; phoneCiphertext: string | null }>(
    'SELECT a.id,s.person_id AS "personId",a.email_blind AS "emailBlind",a.phone_ciphertext AS "phoneCiphertext" FROM ls_identity.accounts a LEFT JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id WHERE a.workspace_id=$1',
    [workspaceId],
   );
   const existingPhones = new Map<string, Set<string | null>>(), existingEmails = new Map<string, Set<string | null>>();
   for (const account of accounts) {
    addOwner(existingEmails, account.emailBlind, account.personId);
    if (account.phoneCiphertext) {
     const phone = normalizePhone(unseal(account.phoneCiphertext, `phone:${workspaceId}:${account.id}`, this.keyring));
     if (phone) addOwner(existingPhones, phone, account.personId);
    }
   }
   for (const row of plan.rows) {
    // Exact replay may follow legitimate account creation, but an endpoint now
    // owned by a different person is never silently accepted as the same lead.
    const linkedPersonId = prior.get(row.legacyId)?.personId;
    const phoneOwners = row.normalizedPhone ? existingPhones.get(row.normalizedPhone) : undefined;
    const emailOwners = row.normalizedEmail ? existingEmails.get(blindEmail(row.normalizedEmail, this.lookupKey)) : undefined;
    for (const owners of [phoneOwners, emailOwners]) {
     if (!owners) continue;
     requireThat(Boolean(linkedPersonId) && [...owners].every(personId => personId === linkedPersonId), "IMPORT_ACCOUNT_ENDPOINT_COLLISION");
    }
   }
   let created = 0, replayed = 0;
   for (const row of plan.rows) {
    const linked = prior.get(row.legacyId);
    if (linked) {
     requireThat(linked.personId === row.suggestedPersonId && linked.rowDigest === row.rowDigest && linked.sourceRevision === snapshot.revision, "IMPORT_EXISTING_LINK_CONFLICT");
     const person = await tx.query<{kind:string;profileCiphertext:string}>(
      'SELECT kind,profile_ciphertext AS "profileCiphertext" FROM ls_identity.people WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
      [workspaceId,linked.personId]);
     requireThat(person.length === 1 && person[0]?.kind === "adult", "IMPORT_REPLAY_PERSON_MISSING");
     const existing = await tx.query<{payloadCiphertext:string;recordMode:string;demoBatchId:string|null}>(
      'SELECT payload_ciphertext AS "payloadCiphertext",record_mode AS "recordMode",demo_batch_id AS "demoBatchId" FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2 FOR UPDATE',
      [workspaceId,linked.personId]);
     requireThat(existing.length === 1 && existing[0]?.recordMode === "live" && existing[0]?.demoBatchId === null,"IMPORT_REPLAY_PROFILE_MISSING");
     let identityProfile:unknown,profile:unknown,storedSnapshot:unknown;
     try {
      identityProfile=JSON.parse(unseal(person[0]!.profileCiphertext,`person:${workspaceId}:${linked.personId}`,this.keyring));
      profile=JSON.parse(unseal(existing[0]!.payloadCiphertext,crmProfileAad(workspaceId,linked.personId),this.keyring));
      storedSnapshot=JSON.parse(unseal(linked.snapshotCiphertext,legacyAad(workspaceId,snapshot,row.legacyId),this.keyring));
     } catch { throw new Error("IMPORT_REPLAY_CIPHERTEXT_UNREADABLE"); }
     requireThat(canonical(identityProfile) === canonical({displayName:row.protectedPayload.displayName}) &&
      canonical(profile) === canonical(profileFromRow(row)) &&
      canonical(storedSnapshot) === canonical({sourceRow:row.sourceRow,payload:row.protectedPayload}),
      "IMPORT_REPLAY_PROTECTED_PAYLOAD_MISMATCH");
     replayed++;
     continue;
    }
    const collision = await tx.query<{ id: string }>('SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=$2', [workspaceId, row.suggestedPersonId]);
    requireThat(collision.length === 0, "IMPORT_PERSON_ID_COLLISION");
    const profile = profileFromRow(row);
    if (apply) {
     const personCiphertext = seal(JSON.stringify({ displayName: row.protectedPayload.displayName }), `person:${workspaceId}:${row.suggestedPersonId}`, this.keyring);
     const profileCiphertext = seal(JSON.stringify(profile), crmProfileAad(workspaceId, row.suggestedPersonId), this.keyring);
     const snapshotCiphertext = seal(JSON.stringify({ sourceRow: row.sourceRow, payload: row.protectedPayload }), legacyAad(workspaceId, snapshot, row.legacyId), this.keyring);
     await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)", [row.suggestedPersonId, workspaceId, personCiphertext, this.clock.now()]);
     await tx.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,'live',NULL)", [workspaceId, row.suggestedPersonId, profileCiphertext]);
     await tx.query("INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [workspaceId, snapshot.fileId, snapshot.sheetId, snapshot.tab, row.legacyId, row.suggestedPersonId, snapshot.revision, row.rowDigest, snapshotCiphertext]);
    }
    created++;
   }
   requireThat(created + replayed === plan.rows.length, "IMPORT_ROW_COUNT_MISMATCH");
   if (apply) {
    const count = await tx.query<{ n: number }>('SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 AND source_sheet_id=$3', [workspaceId, snapshot.fileId, snapshot.sheetId]);
    requireThat(count.length === 1 && count[0]!.n === plan.rows.length, "IMPORT_FINAL_LINK_COUNT_MISMATCH");
    const profiles = await tx.query<{ n: number }>("SELECT count(*)::integer AS n FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND record_mode='live'",[workspaceId]);
    requireThat(profiles.length === 1 && profiles[0]!.n === plan.rows.length, "IMPORT_FINAL_PROFILE_COUNT_MISMATCH");
   }
   return { sourceRevision: snapshot.revision, planned: plan.rows.length, created, replayed };
  });
 }
}

function profileFromRow(row: ImportRow): CrmProfile {
 const stage = row.protectedPayload.stageText.trim() || "new";
 const nextAction = sourceField(row, "Next action").trim() || null;
 const followUpDate = importedFollowUpDate(row);
 const notes = sourceField(row, "General sales notes");
 requireThat(stage.length <= 120 && (nextAction === null || nextAction.length <= 500) && notes.length <= 5000, "IMPORT_PROFILE_FIELD_TOO_LONG");
 return { personId: row.suggestedPersonId, stage, nextAction, followUpDate, notes, legacyIds: [row.legacyId] };
}

function sourceField(row: ImportRow, name: string): string {
 const entry = Object.entries(row.protectedPayload.sourceFields).find(([header]) => header.trim() === name);
 return entry?.[1] ?? "";
}

function addOwner(owners: Map<string, Set<string | null>>, endpoint: string, personId: string | null): void {
 const people = owners.get(endpoint) ?? new Set<string | null>();
 people.add(personId);
 owners.set(endpoint, people);
}

function legacyAad(workspaceId: string, source: SheetSnapshot, leadId: string): string {
 return `ls_contact_ops/legacy/v1/${workspaceId}/${source.fileId}/${source.sheetId}/${leadId}`;
}
