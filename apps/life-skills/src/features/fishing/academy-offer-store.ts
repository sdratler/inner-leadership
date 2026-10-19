import 'server-only';
import {createHash} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import type {IdentityStore} from '../identity/store.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {AcademyFamilyStore} from './academy-family-store.ts';
import {NativeFishingProgram} from './native-program.ts';
import {academyOfferCommandSchema,type AcademyOfferContext} from './academy-offer-contract.ts';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class AcademyOfferStore{
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly family:AcademyFamilyStore,private readonly clock:IdentityClock=systemClock){}
 private program(db:IdentityStore){return new NativeFishingProgram(db,this.config.keyring,{childAccountsEnabled:false,merchant:null},this.clock);}
 async context(actor:Actor,applicationId:string,learnerIndex:number,stageId:string):Promise<AcademyOfferContext>{
  if(actor.role!=='practitioner'||actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');
  const source=await this.family.context(actor,applicationId);if(source.state!=='ready'||!source.saved)return {state:'not_ready'};
  const binding={applicationId,personId:source.personId,expectedEpoch:source.expectedEpoch,expectedAssociationVersion:source.expectedAssociationVersion,expectedFieldsDigest:source.fieldsDigest,expectedFamilyDigest:digest(source.saved)};
  return this.db.transaction(async tx=>{const saved=await this.family.readForEnrollmentInTransaction(tx,actor,binding),child=saved.children.find(c=>c.learnerIndex===learnerIndex);if(!child)throw new AppError('NOT_FOUND');const native=await this.program(this.db).academyOfferContextInTransaction(tx,actor,{learnerId:child.learnerId,householdId:saved.householdId,parentAccountId:saved.parentAccountId},stageId);return {state:'ready',binding,learnerIndex,childName:child.displayName,native};});
 }
 async execute(actor:Actor,raw:unknown){
  if(actor.role!=='practitioner'||actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');const parsed=academyOfferCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const command=parsed.data;
  return this.db.transaction(async tx=>{const saved=await this.family.readForEnrollmentInTransaction(tx,actor,command.binding),child=saved.children.find(c=>c.learnerIndex===command.learnerIndex);if(!child)throw new AppError('NOT_FOUND');const bound:IdentityStore={transaction:work=>work(tx)};return this.program(bound).prepareAcademyOffer(actor,command,{learnerId:child.learnerId,householdId:saved.householdId,parentAccountId:saved.parentAccountId},digest(command));});
 }
}
