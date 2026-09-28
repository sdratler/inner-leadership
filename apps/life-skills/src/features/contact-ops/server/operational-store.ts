import "server-only";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import type {Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {NativeCrmStore,type CrmProfile} from "./native-store.ts";
import {NativeContactDirectory,type NativeContactQuery} from "./native-directory.ts";
import {AppError} from "../../../lib/errors.ts";
import {z} from "zod";
import {ContractError} from "../core/validation.ts";
import {privateDigest} from "./digests.ts";
import {contactSuppressed,prospectUpdateFieldsSchema,type ProspectUpdateFields} from "../../prospects/native-edit.ts";
export type NativeAdminFields=Pick<CrmProfile,"stage"|"nextAction"|"followUpDate"|"notes">;

/** Operational native CRM boundary, not an authority switch. It has no Sheet,
 * network or provider dependency. Routes must supply the observed durable epoch;
 * absence/legacy/frozen/stale authority fails closed, with no fallback write.
 * The encrypted profile operation and authority write counter commit together.
 * Existing shadow/import adapters remain separate and are not operational APIs.
 */
export class OperationalNativeCrmStore {
 private readonly authority:ContactCutoverStore;
 private readonly directory:NativeContactDirectory;
 constructor(private readonly db:IdentityStore,private readonly keyring:Keyring,
  private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock){
  this.authority=new ContactCutoverStore(db,keyring,integrityKey,clock);
  this.directory=new NativeContactDirectory(db,keyring,clock);
 }
 private profileStore(tx:SqlSession):NativeCrmStore{
  // Reuse the exact existing encryption, idempotency, version and demo policies.
  // This adapter cannot acquire another connection or commit independently.
  const scoped:IdentityStore={transaction:work=>work(tx)};
  return new NativeCrmStore(scoped,this.keyring,this.integrityKey,this.clock);
 }
 read(actor:Actor,personId:string,expectedEpoch:number){
  return this.authority.withDestination(actor,{destination:"native",intent:"read",expectedEpoch},
   tx=>this.profileStore(tx).read(actor,personId));
 }
 list(actor:Actor,input:NativeContactQuery,expectedEpoch:number){
  return this.authority.withDestination(actor,{destination:"native",intent:"read",expectedEpoch},
   tx=>this.directory.listInTransaction(tx,actor,input));
 }
 /** Existing Calendar/intake/digest readers must not keep a hidden Sheet
  * dependency after cutover. No page limit may truncate operational follow-ups.
  */
 prospects(actor:Actor,expectedEpoch:number){
  return this.authority.withDestination(actor,{destination:"native",intent:"read",expectedEpoch},
   tx=>this.directory.prospectsInTransaction(tx,actor,expectedEpoch));
 }
 create(actor:Actor,profile:CrmProfile,operationId:string,expectedEpoch:number){
  return this.authority.withDestination(actor,{destination:"native",intent:"write",expectedEpoch},
   tx=>this.profileStore(tx).create(actor,profile,operationId));
 }
 update(actor:Actor,profile:CrmProfile,expectedVersion:number,operationId:string,expectedEpoch:number){
  return this.authority.withDestination(actor,{destination:"native",intent:"write",expectedEpoch},
   tx=>this.profileStore(tx).update(actor,profile,expectedVersion,operationId));
 }
 /** One authority-locked transaction owns read/merge/write. The browser cannot
  * change canonical person or legacy mappings through an administrative edit.
  * The existing receipt binds retries to the exact fields and original version.
  */
 updateFields(actor:Actor,personId:string,fields:NativeAdminFields,expectedVersion:number,operationId:string,expectedEpoch:number){
  return this.authority.withDestination(actor,{destination:"native",intent:"write",expectedEpoch},async tx=>{
   const profiles=this.profileStore(tx),existing=await profiles.read(actor,personId);
   if(!existing)throw new AppError("NOT_FOUND");
   const profile:CrmProfile={...existing.profile,
    stage:fields.stage,nextAction:fields.nextAction,followUpDate:fields.followUpDate,notes:fields.notes,
    ...(existing.profile.doNotContact||contactSuppressed(existing.profile.stage)||contactSuppressed(fields.stage)||
     Object.values(existing.profile.leadUpdates??{}).some(v=>contactSuppressed(v.outcome??""))?{doNotContact:true}:{})};
   return profiles.update(actor,profile,expectedVersion,operationId);
  });
 }
 /** Imported lead references resolve only through the existing exact workspace
  * mapping. No phone/name merge, shadow activation or source snapshot rewrite.
  * The outer receipt binds partial edits BEFORE merging the latest profile, so
  * a retry after another successful edit cannot overwrite the newer notes.
  */
 updateProspectFields(actor:Actor,leadId:string,fields:ProspectUpdateFields,expectedVersion:number,operationId:string,expectedEpoch:number){
  const parsed=prospectUpdateFieldsSchema.safeParse(fields);
  if(!parsed.success||!/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/.test(leadId)||
   !Number.isSafeInteger(expectedVersion)||expectedVersion<1||expectedVersion>=Number.MAX_SAFE_INTEGER||
   !z.string().uuid().safeParse(operationId).success)throw new AppError("INVALID_REQUEST");
  const changes=Object.fromEntries(Object.entries(parsed.data).filter((entry):entry is [string,string]=>typeof entry[1]==="string")) as ProspectUpdateFields;
  const operation="prospect-update:"+operationId;
  const digest=privateDigest({action:"prospect-update",leadId,fields:changes,expectedVersion,expectedEpoch,
   actor:actor.id,workspace:actor.workspaceId},this.integrityKey);
  return this.authority.withDestination(actor,{destination:"native",intent:"write",expectedEpoch},async tx=>{
   const links=await tx.query<{personId:string}>(`SELECT person_id AS "personId" FROM ls_contact_ops.legacy_links
    WHERE workspace_id=$1 AND legacy_lead_id=$2 ORDER BY person_id,source_file_id,source_sheet_id LIMIT 2`,[actor.workspaceId,leadId]);
   if(!links.length)throw new AppError("NOT_FOUND");
   if(links.length!==1)throw new AppError("CONFLICT");
   const personId=links[0]!.personId;
   // The authority fence serializes all native operational writers. This distinct
   // operation namespace also avoids collision with the lower-level profile API.
   const previous=await tx.query<{digest:string;actorId:string;personId:string;version:number}>(`SELECT
    payload_digest AS digest,actor_account_id AS "actorId",person_id AS "personId",result_version AS version
    FROM ls_contact_ops.command_receipts WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,operation]);
   if(previous[0]){
    const prior=previous[0];
    if(prior.digest!==digest||prior.actorId!==actor.id||prior.personId!==personId)throw new AppError("CONFLICT");
    return {personId,version:prior.version,replayed:true};
   }
   const profiles=this.profileStore(tx),existing=await profiles.read(actor,personId);
   if(!existing)throw new AppError("NOT_FOUND");
   if(!existing.profile.legacyIds.includes(leadId))throw new AppError("CONFLICT");
   const priorLead=existing.profile.leadUpdates?.[leadId]??{};
   const profile:CrmProfile={...existing.profile,
    ...(existing.profile.doNotContact||contactSuppressed(existing.profile.stage)||contactSuppressed(changes.stage??"")||contactSuppressed(changes.outcome??"")||
     Object.values(existing.profile.leadUpdates??{}).some(v=>contactSuppressed(v.outcome??""))?{doNotContact:true}:{}),
    ...(changes.stage===undefined?{}:{stage:changes.stage}),
    ...(changes.nextAction===undefined?{}:{nextAction:changes.nextAction||null}),
    ...(changes.dueDate===undefined?{}:{followUpDate:changes.dueDate||null}),
    ...(changes.notes===undefined?{}:{notes:changes.notes}),
    ...(changes.owner===undefined&&changes.outcome===undefined?{}:{leadUpdates:{...existing.profile.leadUpdates,
     [leadId]:{...priorLead,...(changes.owner===undefined?{}:{owner:changes.owner}),...(changes.outcome===undefined?{}:{outcome:changes.outcome})}}})};
   let result:{version:number;replayed:boolean};
   try{result=await profiles.update(actor,profile,expectedVersion,"prospect-profile-update:"+operationId);}
   catch(error){if(error instanceof ContractError&&["STALE_PROFILE_VERSION","OPERATION_REUSED_WITH_DIFFERENT_INPUT"].includes(error.code))throw new AppError("CONFLICT");throw error;}
   await tx.query(`INSERT INTO ls_contact_ops.command_receipts(workspace_id,operation_id,person_id,actor_account_id,payload_digest,result_version)
    VALUES($1,$2,$3,$4,$5,$6)`,[actor.workspaceId,operation,personId,actor.id,digest,result.version]);
   return {personId,...result};
  });
 }
}
