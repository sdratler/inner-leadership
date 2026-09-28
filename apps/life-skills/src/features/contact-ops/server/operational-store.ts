import "server-only";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import type {Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {NativeCrmStore,type CrmProfile} from "./native-store.ts";
import {NativeContactDirectory,type NativeContactQuery} from "./native-directory.ts";
import {AppError} from "../../../lib/errors.ts";
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
   tx=>this.directory.prospectsInTransaction(tx,actor));
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
   const profile:CrmProfile={personId:existing.profile.personId,legacyIds:existing.profile.legacyIds,
    stage:fields.stage,nextAction:fields.nextAction,followUpDate:fields.followUpDate,notes:fields.notes};
   return profiles.update(actor,profile,expectedVersion,operationId);
  });
 }
}
