import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {requirePractitioner} from '../cases/policy.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import type {FounderFamily} from './academy-founder-store.ts';
import {floridaCalendarDays} from './academy-founder-contract.ts';
import {founderTransitionChain,founderTransitionPurposeSchema,founderTransitionSchema,founderTransitionSelectionSchema,founderTransitionVersion,type FounderTransitionPurpose} from './academy-founder-transition-contract.ts';

type Header={id:string;familyId:string;fromRevision:number;toRevision:number;kind:string;purposeHash:string;actorId:string|null;at:Date;ciphertext:string};
/** Immutable audit provenance only. No grant, runtime factory or payment port. */
export class AcademyFounderTransitionStore{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ring:Keyring,private readonly key:string,private readonly clock:IdentityClock=systemClock){}
 private hash(domain:string,value:unknown){return privateDigest({domain:'academy-founder-transition-v1/'+domain,workspaceId:this.workspace,value},this.key);}
 stateHash(f:FounderFamily){return this.hash('state',f);}
 templateHash(offer:NonNullable<FounderFamily['offer']>){return this.hash('commercial-template',offer);}
 private aad(h:Omit<Header,'ciphertext'>){return 'academy-founder-transition-v1/'+this.workspace+'/'+this.hash('aad-headers',{familyId:h.familyId,id:h.id,fromRevision:h.fromRevision,toRevision:h.toRevision,kind:h.kind,purposeHash:h.purposeHash,actorId:h.actorId,at:h.at.toISOString()});}
 async append(tx:SqlSession,before:FounderFamily,after:FounderFamily,raw:FounderTransitionPurpose){
  const purpose=founderTransitionPurposeSchema.parse(raw),id=randomUUID(),at=this.clock.now();
  if(before.id!==after.id||after.revision!==before.revision+1||!Number.isFinite(at.valueOf()))throw new AppError('CONFLICT');
  let actorId:string|null=null;
  if(purpose.kind==='commercial_template_approved'){
   actorId=purpose.ownerId;
   if(!after.offer||after.status!=='offered'||after.paused||purpose.offerId!==after.offer.id||purpose.generation!==after.payment.generation||purpose.generation!==before.payment.generation+1||after.payment.sentAt!==null||after.payment.deadline!==null||purpose.templateSha256!==this.templateHash(after.offer))throw new AppError('CONFLICT');
  }
  if(purpose.kind==='offer_email_sent'){
   actorId=purpose.reviewedBy;
   if(!after.offer||!before.offer||after.status!=='offered'||after.paused||after.payment.exception||before.payment.sentAt!==null||after.payment.sentAt!==purpose.sentAt||after.payment.deadline!==purpose.deadline||floridaCalendarDays(new Date(purpose.sentAt),7).toISOString()!==purpose.deadline||Date.parse(purpose.deadline)>Date.parse(after.offer.firstSession)||purpose.offerId!==after.offer.id||purpose.generation!==after.payment.generation||purpose.generation!==before.payment.generation||purpose.templateSha256!==this.templateHash(after.offer)||this.templateHash(before.offer)!==purpose.templateSha256)throw new AppError('CONFLICT');
   await this.assertSent(tx,after,purpose);
  }
  const payload=founderTransitionSchema.parse({version:founderTransitionVersion,id,workspaceId:this.workspace,familyId:before.id,actorId,recordedAt:at.toISOString(),fromRevision:before.revision,toRevision:after.revision,beforeSha256:this.stateHash(before),afterSha256:this.stateHash(after),purpose});
  const h={id,familyId:before.id,fromRevision:before.revision,toRevision:after.revision,kind:purpose.kind,purposeHash:this.hash('purpose',purpose),actorId,at};
  await tx.query('INSERT INTO ls_service_interest.academy_founder_events(workspace_id,family_id,id,at,actor_id,payload_ciphertext,transition_from,transition_to,transition_kind,transition_purpose_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[this.workspace,h.familyId,id,at,actorId,seal(JSON.stringify(payload),this.aad(h),this.ring),h.fromRevision,h.toRevision,h.kind,h.purposeHash]);
 }
 private async assertSent(tx:SqlSession,f:FounderFamily,p:Extract<FounderTransitionPurpose,{kind:'offer_email_sent'}>){
  const row=await one<{state:string;providerId:string|null;at:Date|null;payload:string}>(tx,"SELECT state,provider_id AS \"providerId\",completed_at AS at,payload_ciphertext AS payload FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND founder_id=$2 AND id=$3 AND purpose='academy_founder_offer' FOR SHARE",[this.workspace,f.id,p.messageId]);
  if(!row||row.state!=='sent'||row.providerId!==p.providerId||row.at?.toISOString()!==p.sentAt)throw new AppError('CONFLICT');
  const mail=JSON.parse(unseal(row.payload,'ls_service_interest/inquiry_email/v1/'+this.workspace+'/'+p.messageId,this.ring));
  if(mail.familyId!==f.id||mail.kind!=='offer'||mail.generation!==p.generation||mail.to!==f.email||!mail.offer||this.templateHash(mail.offer)!==p.templateSha256)throw new AppError('CONFLICT');
 }
 async read(actor:Actor,raw:unknown){
  const parsed=founderTransitionSelectionSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const input=parsed.data;
  try{return await this.db.transaction(async tx=>{
   if(actor.workspaceId!==this.workspace)throw new AppError('FORBIDDEN');await lockWorkspace(tx,this.workspace);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const row=await one<{revision:number;status:string;allocated:boolean;household:string|null;ciphertext:string}>(tx,'SELECT revision,status,allocated,native_household_id AS household,payload_ciphertext AS ciphertext FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspace,input.familyId]);if(!row)throw new AppError('NOT_FOUND');
   const f=JSON.parse(unseal(row.ciphertext,'ls_service_interest/founder/v1/'+this.workspace+'/'+input.familyId,this.ring)) as FounderFamily;
   if(f.id!==input.familyId||f.revision!==row.revision||f.status!==row.status||f.allocated!==row.allocated||(f.nativeBinding?.householdId??null)!==row.household)throw new AppError('UNAVAILABLE');
   if(row.revision<input.fromRevision||row.revision-input.fromRevision>100)throw new AppError('CONFLICT');
   const rows=await tx.query<Header>('SELECT id,family_id AS "familyId",transition_from AS "fromRevision",transition_to AS "toRevision",transition_kind AS kind,transition_purpose_sha256 AS "purposeHash",actor_id AS "actorId",at,payload_ciphertext AS ciphertext FROM ls_service_interest.academy_founder_events WHERE workspace_id=$1 AND family_id=$2 AND transition_to>$3 ORDER BY transition_to LIMIT 101',[this.workspace,input.familyId,input.fromRevision]);
   const transitions=rows.map(h=>{if(h.ciphertext.length>16000)throw new AppError('UNAVAILABLE');const t=founderTransitionSchema.parse(JSON.parse(unseal(h.ciphertext,this.aad(h),this.ring)));if(t.workspaceId!==this.workspace||t.id!==h.id||t.familyId!==h.familyId||t.fromRevision!==h.fromRevision||t.toRevision!==h.toRevision||t.actorId!==h.actorId||t.recordedAt!==h.at.toISOString()||t.purpose.kind!==h.kind||this.hash('purpose',t.purpose)!==h.purposeHash)throw new AppError('UNAVAILABLE');return t;});
   const result=founderTransitionChain({...input,workspaceId:this.workspace,toRevision:f.revision,toSha256:this.stateHash(f)},transitions);
   for(const t of transitions)if(t.purpose.kind==='offer_email_sent'){if(!f.offer||this.templateHash(f.offer)!==t.purpose.templateSha256)throw new AppError('CONFLICT');await this.assertSent(tx,f,t.purpose);}
   requirePractitioner(await freshActor(tx,actor,this.clock.now()));return result;
  });}catch(error){if(error instanceof AppError)throw error;throw new AppError('UNAVAILABLE');}
 }
}
