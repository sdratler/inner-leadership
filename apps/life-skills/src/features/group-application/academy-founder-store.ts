import 'server-only';
import {SignupEmailNotAttemptedError,assertSignupWorkerAdmission,signupWorkerFamilyAllowed,signupWorkerReferences,signupWorkerMessageAllowed,type SignupWorkerAdmission} from './academy-signup-worker-admission.ts';
import {AcademyCampaignStore} from './academy-campaign-store.ts';
import {signupEmailReview} from './academy-signup-email-review.ts';
import {campaignAttributionSchema,currentReminderLines,floridaDate,PAYMENT_REMINDER_SCHEDULE,type CampaignAttribution,type CampaignShareCommand,type PaymentReminderProjection} from './academy-campaign-contract.ts';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import {requirePractitioner} from '../cases/policy.ts';
import {opaqueToken,tokenDigest,seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {Actor,IdentityClock} from '../identity/types.ts';
import type {AuthEmailTransport} from '../../providers/email/transport.ts';
import {captureCommunicationPreferences,academyRecordedCommunicationPreferencesSchema,type AcademyRecordedCommunicationPreferences} from './academy-communication-preferences.ts';
import type {GroupApplicationFields} from './contract.ts';
import {isFloridaGroupApplication,isSchoolInquiry} from './contract.ts';
import {isFreeAcademyRegistrationVersion} from './academy-registration.ts';
import {INQUIRY_EMAIL_FROM} from './inquiry-email-copy.ts';
import {FOUNDER_CAPACITY,FOUNDER_DECISION,FOUNDER_TIMEZONE,FOUNDER_REMINDER_DEFAULTS,floridaCalendarDays,founderOwnerCommandSchema,founderPrice,occupiesFounder,founderPublicEmailState,founderPublicConfirmationState,type FounderStatus,type FounderPublicResult,type FounderOwnerCommand,type FounderNativeFamily} from './academy-founder-contract.ts';
import {founderEmailContent,isAnnouncementR00,type FounderMail,type FounderMailKind} from './academy-founder-email.ts';
import type {FounderCommercialFamily} from '../fishing/academy-founder-commercial-intent-contract.ts';
import {AcademyFounderTransitionStore} from './academy-founder-transition-store.ts';
import type {FounderTransitionPurpose} from './academy-founder-transition-contract.ts';

export interface FounderNativeFamilyPort{read(tx:SqlSession,actor:Actor,family:FounderFamily,binding:FounderNativeFamily['source']):Promise<FounderNativeFamily>;}

type Window={generation:number;sentAt:string|null;deadline:string|null;exception:boolean;confirmedAt:string|null;deliveryOutcome?:'failed'|'unknown'};
export type VerifiedFounderOffer={id:string;group:string;groupId:string;firstSession:string;paymentUrl:string;terms:string;priceVersion:string;children:{id:string;name:string;amount:number}[]};
type ExactSignupContent={version:'JLFA-EXACT-COPY-20261026-05';catalogSha256:string;exceptionVersion:'JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01';approvalReceiptSha256:string};
const exactSignupContent:ExactSignupContent=Object.freeze({version:'JLFA-EXACT-COPY-20261026-05',catalogSha256:'250632ed159824f47fcd8d44d2ef2fbb636ffc4544ef0715666917950942d82b',exceptionVersion:'JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01',approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'});
/** Captured only by new v5 creation. Content provenance grants no send authority. */
export type FounderFamily={signupContent?:ExactSignupContent;communicationPreferences?:AcademyRecordedCommunicationPreferences;initialStatus?:'reserved'|'regular_registration'|'pending_verification';everPaid?:boolean;nativeBinding?:FounderNativeFamily;id:string;reference:string;status:FounderStatus;allocated:boolean;revision:number;submittedAt:string;locale:'en'|'he';email:string;parentName:string;children:{id:string;name:string;age:number}[];identityApproved:boolean;interest:Window;payment:Window;tokenHash:string|null;paused:boolean;offer:VerifiedFounderOffer|null;redeemedChildIds:string[];collectedCents:number;enrolledChildIds:string[]};
/** Supplied only by the separately admitted native/PAY integration. Never an HTTP proof DTO.
 * Calls share the campaign transaction/lock. Provider closure runs outside it;
 * final inspection verifies terminal closure and signed settlements before safe. */
export type FounderActivationWindow={sentAt:string;deadline:string;timezone:typeof FOUNDER_TIMEZONE;messageId:string;providerId:string;generation:number};
export interface FounderPaymentPort{
 /** Current authenticated owner prepares a bound inactive intent. Worker
  * activation needs separately admitted durable owner continuation authority;
  * verifiedBy is never a session. No payable provider object is created here. */
 approve(tx:SqlSession,actor:Actor,family:FounderFamily,input:{groupId:string;firstSession:string;plan:'prepay'|'monthly_block';expectedAmounts:{id:string;amount:number}[]}):Promise<VerifiedFounderOffer>;
 activateWindow(tx:SqlSession,family:FounderFamily,offer:VerifiedFounderOffer,window:FounderActivationWindow):Promise<boolean>;
 /** A separate versioned extension; never rewrite an issued immutable offer. */
 extendWindow?(tx:SqlSession,family:FounderFamily,offer:VerifiedFounderOffer,window:FounderActivationWindow&{previousDeadline:string}):Promise<boolean>;
 /** Commit closure intent only. Known-ID provider work happens AFTER commit. */
 requestClosure?(tx:SqlSession,family:FounderFamily,input:{operatorId:string;reason:string}):Promise<boolean>;
 /** collectedCents is cumulative verified GROSS receipts for this offer, never
  * net of refunds or a current-access flag. Refund facts stay in native PAY. */
 reminderProjection?(tx:SqlSession,family:FounderFamily):Promise<PaymentReminderProjection>;
 inspect(tx:SqlSession,family:FounderFamily):Promise<{inFlight:boolean;paidChildIds:string[];collectedCents:number;enrolledChildIds:string[]}>;
 /** Inspect/reconcile ALREADY recorded terminal closure. Must not start a
  * closure here: an unsafe withdrawal throws and rolls this transaction back. */
 reconcileAndClose(tx:SqlSession,family:FounderFamily):Promise<{safeToRelease:boolean;paidChildIds:string[];collectedCents:number;enrolledChildIds:string[]}>;
}
type StoredFounderMail=FounderMail&{templateCatalogSha256?:string;heldSignupContent?:'historical_clock'};
type Row={id:string;revision:number;status:FounderStatus;ciphertext:string;allocated:boolean;nativeHouseholdId:string|null};
const select=`SELECT id,revision,status,allocated,payload_ciphertext AS ciphertext,native_household_id AS "nativeHouseholdId" FROM ls_service_interest.academy_founder_families`;
const txMailSelect='SELECT id,payload_ciphertext AS ciphertext FROM ls_service_interest.inquiry_email_outbox';
const paymentKind=(kind:FounderMailKind)=>kind==='offer'||kind==='payment_reminder'||kind==='payment_deadline_receipt';
export type FounderMailScope='signup'|'all';
/** Advisory scan position only. Every candidate still needs current admission. */
export type SignupDispatchCursor=Readonly<{createdAt:string;id:string}>;
const signupMailPurposes=['academy_founder_interest','academy_founder_ack','academy_founder_interest_reminder','academy_founder_interest_deadline_receipt'];
const paymentFamily=(f:FounderFamily)=>!!f.offer||!!f.payment.sentAt||!!f.everPaid||f.redeemedChildIds.length>0||f.collectedCents>0||f.enrolledChildIds.length>0;
const emptyWindow=():Window=>({generation:1,sentAt:null,deadline:null,exception:false,confirmedAt:null});
export function isFreeFounderRegistration(fields:GroupApplicationFields){return isFloridaGroupApplication(fields)&&!isSchoolInquiry(fields)&&isFreeAcademyRegistrationVersion(fields.academyRegistration?.version);}
export class AcademyFounderStore{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ring:Keyring,private readonly digestKey:string,private readonly clock:IdentityClock,private readonly paymentPort:FounderPaymentPort|null=null,private readonly nativeFamilies:FounderNativeFamilyPort|null=null,private readonly signupContent:SignupWorkerAdmission|null=null){}
 private campaign(){return new AcademyCampaignStore(this.workspace,this.ring,this.digestKey,()=>this.clock.now());}
 async bindAttribution(tx:SqlSession,operationId:string,applicationId:string,value:CampaignAttribution|null){await this.campaign().attribution(tx,operationId,applicationId,value===null?null:campaignAttributionSchema.parse(value));}
 async checkAttribution(tx:SqlSession,operationId:string,value:CampaignAttribution|null){await this.campaign().checkAttribution(tx,operationId,value);}
 async campaignExecute(actor:Actor,input:CampaignShareCommand){if(actor.workspaceId!==this.workspace)throw new AppError('FORBIDDEN');return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);requirePractitioner(await freshActor(tx,actor,this.clock.now()));return this.campaign().execute(tx,actor.id,input);});}
 private aad(id:string){return `ls_service_interest/founder/v1/${this.workspace}/${id}`;}
 private digest(value:unknown){return privateDigest({domain:'academy-founder-v1',workspace:this.workspace,value},this.digestKey);}
 private decode(row:Row):FounderFamily{const f=JSON.parse(unseal(row.ciphertext,this.aad(row.id),this.ring)) as FounderFamily;if(f.id!==row.id||f.revision!==row.revision||f.status!==row.status||f.allocated!==row.allocated||(f.nativeBinding?.householdId??null)!==row.nativeHouseholdId)throw new AppError('UNAVAILABLE');return f;}
 private async get(tx:SqlSession,id:string){const row=await one<Row>(tx,select+' WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspace,id]);if(!row)throw new AppError('NOT_FOUND');return this.decode(row);}
 private transitions(){return new AcademyFounderTransitionStore(this.db,this.workspace,this.ring,this.digestKey,this.clock);}
 private sentPurpose(f:FounderFamily,messageId:string,providerId:string,reviewedBy:string|null):FounderTransitionPurpose{
  if(!f.offer||!f.payment.sentAt||!f.payment.deadline)throw new AppError('UNAVAILABLE');
  return {kind:'offer_email_sent',messageId,providerId,sentAt:f.payment.sentAt,deadline:f.payment.deadline,generation:f.payment.generation,offerId:f.offer.id,templateSha256:this.transitions().templateHash(f.offer),reviewedBy};
 }
 private async save(tx:SqlSession,f:FounderFamily,purpose:FounderTransitionPurpose={kind:'other'}){
  const before=await this.get(tx,f.id);if(f.revision!==before.revision)throw new AppError('CONFLICT');
  f.revision++;const changed=await tx.query('UPDATE ls_service_interest.academy_founder_families SET status=$3,revision=$4,payload_ciphertext=$5,allocated=$6,token_digest=$7,native_household_id=$8 WHERE workspace_id=$1 AND id=$2 AND revision=$9 RETURNING id',[this.workspace,f.id,f.status,f.revision,seal(JSON.stringify(f),this.aad(f.id),this.ring),f.allocated,f.tokenHash,f.nativeBinding?.householdId??null,before.revision]);
  if(changed.length!==1)throw new AppError('CONFLICT');await this.transitions().append(tx,before,f,purpose);if(before.allocated!==f.allocated)await this.campaign().allocationChanged(tx);
 }
 private async event(tx:SqlSession,f:FounderFamily,action:string,actor:string|null,reason:string){const id=randomUUID();await tx.query('INSERT INTO ls_service_interest.academy_founder_events(workspace_id,family_id,id,at,actor_id,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[this.workspace,f.id,id,this.clock.now(),actor,seal(JSON.stringify({action,reason,revision:f.revision,decision:FOUNDER_DECISION}),this.aad(id),this.ring)]);}
 private async occupied(tx:SqlSession){const r=await one<{n:number}>(tx,'SELECT count(*)::int AS n FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1 AND allocated=true',[this.workspace]);if(!r||r.n<0||r.n>FOUNDER_CAPACITY)throw new AppError('UNAVAILABLE');return r.n;}
 async aggregate(){return this.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');return this.campaign().snapshot(tx);});}
 async publicResult(tx:SqlSession,applicationId:string):Promise<FounderPublicResult|undefined>{
  const row=await one<{familyId:string}>(tx,'SELECT family_id AS "familyId" FROM ls_service_interest.academy_founder_applications WHERE workspace_id=$1 AND application_id=$2',[this.workspace,applicationId]);if(!row)return undefined;
  const raw=await one<Row>(tx,select+' WHERE workspace_id=$1 AND id=$2',[this.workspace,row.familyId]);if(!raw)throw new AppError('UNAVAILABLE');const f=this.decode(raw);
  const messages=await tx.query<{state:string}>('SELECT state FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND founder_id=$2 AND purpose=$3 ORDER BY created_at DESC',[this.workspace,f.id,'academy_founder_interest']);
  const state=messages[0]?.state;
  return {reference:f.reference,...(f.initialStatus?{initialStatus:f.initialStatus}:{}),status:f.status==='pending_verification'?'pending_verification':['expired','withdrawn'].includes(f.status)?'closed':!f.allocated?'regular_registration':f.interest.confirmedAt?'confirmed':'reserved',email:founderPublicEmailState({outboxState:state,exception:f.interest.exception,knownDeliveryFailure:f.interest.deliveryOutcome==='failed'}),receiptEmail:f.email,founderRateReserved:f.allocated,deadline:null,timezone:FOUNDER_TIMEZONE};
 }
 /** Runs ONLY within accepted public form transaction; never imports old inquiries. */
 async accept(tx:SqlSession,applicationId:string,fields:GroupApplicationFields,continuation:string){
  if(!isFloridaGroupApplication(fields)||isSchoolInquiry(fields)||!fields.academyRegistration||!isFreeFounderRegistration(fields))throw new AppError('INVALID_REQUEST');
  await this.campaign().initialize(tx);const r=fields.academyRegistration,email=r.receiptEmail;if(!email)throw new AppError('INVALID_REQUEST');
  const continuationDigest=tokenDigest(continuation),prior=await one<Row>(tx,select+' WHERE workspace_id=$1 AND continuation_digest=$2 FOR UPDATE',[this.workspace,continuationDigest]);
  if(prior){const f=this.decode(prior);
   // A capability proves continuity, not permission to replace a household.
   if(f.email!==email||f.parentName.normalize('NFKC').trim().toLowerCase()!==fields.parentName.normalize('NFKC').trim().toLowerCase())throw new AppError('CONFLICT');
   await tx.query('INSERT INTO ls_service_interest.academy_founder_applications(workspace_id,application_id,family_id) VALUES($1,$2,$3)',[this.workspace,applicationId,f.id]);
   for(const c of r.learners){const existing=f.children.find(p=>p.id===c.id);if(existing){existing.name=c.fullName;existing.age=c.ageYears;}else f.children.push({id:c.id,name:c.fullName,age:c.ageYears});}
   if(r.communicationPreferences)f.communicationPreferences=captureCommunicationPreferences(r.communicationPreferences,applicationId,this.clock.now(),f.communicationPreferences);
   await this.save(tx,f);await this.event(tx,f,'amendment',null,'Accepted sibling/language continuation; no additional allocation');return this.publicResult(tx,applicationId);
  }
  // Exact contact collisions are reconciled, not silently merged or allocated twice.
  const identity=this.digest({parent:fields.parentName.normalize('NFKC').trim().toLowerCase(),postal:r.postalCode}),emailDigest=this.digest({email});
  const collision=await tx.query('SELECT id FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1 AND (identity_digest=$2 OR email_digest=$3)',[this.workspace,identity,emailDigest]);
  const campaign=await this.campaign().snapshot(tx);
  const status:FounderStatus=collision.length||r.learners.some(c=>c.ageYears<8)?'pending_verification':campaign.phase==='PRE_REGISTRATION'&&campaign.remaining>0?'provisional':'interest_list';
  const f:FounderFamily={...(r.version==='JLFA-FREE-REGISTRATION-20261026-05-v5'?{signupContent:{...exactSignupContent}}:{}),...(r.communicationPreferences?{communicationPreferences:captureCommunicationPreferences(r.communicationPreferences,applicationId,this.clock.now())}:{}),initialStatus:status==='pending_verification'?'pending_verification':status==='provisional'?'reserved':'regular_registration',id:randomUUID(),reference:applicationId,status,allocated:status==='provisional',revision:1,submittedAt:this.clock.now().toISOString(),locale:fields.language,email,parentName:fields.parentName,children:r.learners.map(c=>({id:c.id,name:c.fullName,age:c.ageYears})),identityApproved:status!=='pending_verification',interest:emptyWindow(),payment:emptyWindow(),tokenHash:null,paused:false,offer:null,redeemedChildIds:[],collectedCents:0,enrolledChildIds:[]};
  await tx.query(`INSERT INTO ls_service_interest.academy_founder_families(workspace_id,id,application_id,continuation_digest,identity_digest,email_digest,revision,status,payload_ciphertext,submitted_at,allocated) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10)`,[this.workspace,f.id,applicationId,continuationDigest,identity,emailDigest,status,seal(JSON.stringify(f),this.aad(f.id),this.ring),this.clock.now(),f.allocated]);
  await tx.query('INSERT INTO ls_service_interest.academy_founder_applications(workspace_id,application_id,family_id) VALUES($1,$2,$3)',[this.workspace,applicationId,f.id]);
  if(f.allocated)await this.campaign().allocationChanged(tx);await this.queue(tx,f,'interest',`interest:${f.interest.generation}`);await this.save(tx,f);await this.event(tx,f,'signup',null,'Actual completed form; '+status);return this.publicResult(tx,applicationId);
 }
 private async inheritedAckIdentity(tx:SqlSession,f:FounderFamily){
  const rows=await tx.query<{id:string;ciphertext:string}>(txMailSelect+" WHERE workspace_id=$1 AND founder_id=$2 AND purpose='academy_founder_interest' AND state='sent' AND provider_id IS NOT NULL ORDER BY created_at DESC LIMIT 101",[this.workspace,f.id]);
  if(rows.length>100)throw new AppError('UNAVAILABLE');
  const matching=rows.map(row=>JSON.parse(unseal(row.ciphertext,`ls_service_interest/inquiry_email/v1/${this.workspace}/${row.id}`,this.ring)) as StoredFounderMail).filter(p=>p.generation===f.interest.generation);
  const exact=matching.filter(p=>p.transactional!==undefined);
  if(!exact.length)return null; // Original legacy sends retain their old semantics.
  if(!academyRecordedCommunicationPreferencesSchema.safeParse(f.communicationPreferences).success)throw new AppError('UNAVAILABLE');
  if(exact.length!==1||matching.length!==1)throw new AppError('UNAVAILABLE');const p=exact[0]!;
  const currentHash=createHash('sha256').update(readFileSync(resolve(process.cwd(),'src/features/group-application/academy-exact-email-copy.json'))).digest('hex');
  if(p.kind!=='interest'||p.transactional!.templateId!=='R00'||p.transactional!.version!=='JLFA-EXACT-COPY-20261026-05'||p.familyId!==f.id||p.reference!==f.reference||p.to!==f.email||!p.token||tokenDigest(p.token)!==f.tokenHash||!f.interest.sentAt)throw new AppError('UNAVAILABLE');
  const historical=p.transactional!.r00Exception as {version:string;approvalReceiptSha256:string}|undefined;
  if(historical?.version==='JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01'&&historical.approvalReceiptSha256==='7dfc71f18f0f853bb11f4bc1de0547484c13a9bbfa1f82eeab30d0eaf95aca87'&&p.templateCatalogSha256==='175d4bbc87d94d2632c6a1be0092784ad14e4eb7dbc25825c6ec0106d2f3e1ea')return {held:true as const}; // Distinct from legacy/no-exact; never infer current authority.
  if(!isAnnouncementR00(p)||p.templateCatalogSha256!==currentHash)throw new AppError('UNAVAILABLE');
  return {templateCatalogSha256:p.templateCatalogSha256,transactional:{version:'JLFA-EXACT-COPY-20261026-05' as const,templateId:'R03' as const,confirmed:true,founderRateReserved:f.allocated}};
 }
 private async queue(tx:SqlSession,f:FounderFamily,kind:FounderMailKind,key:string,daily?:Pick<FounderMail,'reminderDate'|'unpaidLines'>,interestDay?:3|6){
  // Same-key payload identity is immutable. Never upgrade existing legacy,
  // canceled, queued, UNKNOWN or sent rows to exact05 or a new language.
  if(kind!=='payment_reminder'&&await one<{id:string}>(tx,'SELECT id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND founder_id=$2 AND message_key=$3 FOR UPDATE',[this.workspace,f.id,key]))return;
  let token:string|undefined;
  if(kind==='interest'){token=opaqueToken();f.tokenHash=tokenDigest(token);}
  if(kind==='interest_reminder'){
   const source=await tx.query<{id:string;ciphertext:string}>(txMailSelect+' WHERE workspace_id=$1 AND founder_id=$2 AND purpose=$3 ORDER BY created_at DESC',[this.workspace,f.id,'academy_founder_interest']);
   for(const row of source){const p=JSON.parse(unseal(row.ciphertext,`ls_service_interest/inquiry_email/v1/${this.workspace}/${row.id}`,this.ring)) as FounderMail;if(p.generation===f.interest.generation&&p.token&&tokenDigest(p.token)===f.tokenHash){token=p.token;break;}}
   if(!token)throw new AppError('UNAVAILABLE');
  }
  const p:StoredFounderMail={...daily,familyId:f.id,generation:paymentKind(kind)?f.payment.generation:f.interest.generation,kind,locale:f.locale,to:f.email,reference:f.reference,status:f.status==='pending_verification'?'pending_verification':!f.allocated?'interest_list':'reserved',...(token?{token}:{}),...(f.offer?{offer:f.offer}:{})};
  if(kind==='payment_reminder'){
   const existing=await one<{id:string;state:string;reserved:Date|null;provider:string|null;ciphertext:string}>(tx,"SELECT id,state,reserved_at AS reserved,provider_id AS provider,payload_ciphertext AS ciphertext FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND founder_id=$2 AND message_key=$3 FOR UPDATE",[this.workspace,f.id,key]);
   if(existing){if(['queued','canceled'].includes(existing.state)&&!existing.reserved&&!existing.provider){const before=unseal(existing.ciphertext,`ls_service_interest/inquiry_email/v1/${this.workspace}/${existing.id}`,this.ring),prepared=JSON.parse(before) as {locale?:unknown};if(prepared.locale!=='en'&&prepared.locale!=='he')throw new AppError('UNAVAILABLE');p.locale=prepared.locale;if(existing.state==='canceled'||before!==JSON.stringify(p)){await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='queued',completed_at=NULL,payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[this.workspace,existing.id,seal(JSON.stringify(p),`ls_service_interest/inquiry_email/v1/${this.workspace}/${existing.id}`,this.ring)]);await this.event(tx,f,'daily_reminder_rebuilt',null,JSON.stringify({date:p.reminderDate,previous:this.digest(JSON.parse(before)),current:this.digest(p)}));}}return;}
  }
  // Preference changes apply only to new message creation, never an existing same-key reminder.
  if(f.communicationPreferences!==undefined)p.locale=academyRecordedCommunicationPreferencesSchema.parse(f.communicationPreferences).selection.parentLanguage;
  if(kind==='ack'&&f.interest.confirmedAt){const inherited=await this.inheritedAckIdentity(tx,f);if(inherited&&'held' in inherited)p.heldSignupContent='historical_clock';else if(inherited){p.templateCatalogSha256=inherited.templateCatalogSha256;p.transactional=inherited.transactional;}}
  const choice=academyRecordedCommunicationPreferencesSchema.safeParse(f.communicationPreferences);
  if(f.signupContent!==undefined&&!paymentKind(kind)&&!p.heldSignupContent){
   const c=f.signupContent,currentHash=createHash('sha256').update(readFileSync(resolve(process.cwd(),'src/features/group-application/academy-exact-email-copy.json'))).digest('hex');
   const currentContent=c.version===exactSignupContent.version&&c.catalogSha256===exactSignupContent.catalogSha256&&c.exceptionVersion===exactSignupContent.exceptionVersion&&c.approvalReceiptSha256===exactSignupContent.approvalReceiptSha256&&currentHash===c.catalogSha256;
   // A compatible API submission may omit a choice. Keep its intent unsendable;
   // never infer parent language from page/group locale or upgrade its same key.
   const templateId=kind==='interest'?'R00':kind==='ack'&&f.interest.confirmedAt?'R03':kind==='interest_reminder'&&interestDay===3?'R01':kind==='interest_reminder'&&interestDay===6?'R02':null;
   if(currentContent&&choice.success&&templateId){p.templateCatalogSha256=c.catalogSha256;p.transactional={version:c.version,templateId,...(templateId==='R00'?{r00Exception:{version:c.exceptionVersion,approvalReceiptSha256:c.approvalReceiptSha256}}:{}),...(templateId==='R03'?{confirmed:true,founderRateReserved:f.allocated}:{}),...((templateId==='R01'||templateId==='R02')&&f.interest.sentAt?{acceptedSend:{sentAt:f.interest.sentAt}}:{})};}
  }
  const content=this.signupContent;
  if(!p.heldSignupContent&&f.signupContent===undefined&&content&&signupWorkerFamilyAllowed(content,f,this.clock.now())&&!paymentKind(kind)&&choice.success){
   const templateId=kind==='interest'?'R00':kind==='ack'&&f.interest.confirmedAt?'R03':kind==='interest_reminder'&&interestDay===3?'R01':kind==='interest_reminder'&&interestDay===6?'R02':null;
   if(templateId){p.templateCatalogSha256=content.templateCatalogSha256;p.transactional={version:'JLFA-EXACT-COPY-20261026-05',templateId,...(templateId==='R00'&&content.r00Exception?{r00Exception:content.r00Exception}:{}),...(templateId==='R03'?{confirmed:true,founderRateReserved:f.allocated}:{}),...((templateId==='R01'||templateId==='R02')&&f.interest.sentAt?{acceptedSend:{sentAt:f.interest.sentAt}}:{})};}
   // R00 never invents acceptedSend. Only a separately receipted controlled-test
   // exception may render the relative line; old same-key payloads stay untouched.
  }
  const id=randomUUID();await tx.query(`INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,created_at,founder_id,message_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[this.workspace,id,f.reference,'academy_founder_'+kind,seal(JSON.stringify(p),`ls_service_interest/inquiry_email/v1/${this.workspace}/${id}`,this.ring),this.clock.now(),f.id,key]);
 }
 private async cancelQueued(tx:SqlSession,f:FounderFamily,scope:FounderMailScope='all'){await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='canceled',completed_at=$3 WHERE workspace_id=$1 AND founder_id=$2 AND state='queued' AND ($4::boolean=false OR purpose IN ($5,$6,$7,$8))",[this.workspace,f.id,this.clock.now(),scope==='signup',...signupMailPurposes]);}
 private async hasUnknown(tx:SqlSession,f:FounderFamily,payment:boolean){const rows=await tx.query<{id:string;ciphertext:string}>(txMailSelect+" WHERE workspace_id=$1 AND founder_id=$2 AND state='unknown'",[this.workspace,f.id]);return rows.some(row=>{const p=JSON.parse(unseal(row.ciphertext,`ls_service_interest/inquiry_email/v1/${this.workspace}/${row.id}`,this.ring)) as FounderMail;return paymentKind(p.kind)===payment&&p.generation===(payment?f.payment:f.interest).generation;});}
 async confirmationContext(token:string){const hash=tokenDigest(token);return this.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');const row=await one<Row>(tx,select+' WHERE workspace_id=$1 AND token_digest=$2',[this.workspace,hash]);if(!row)throw new AppError('NOT_FOUND');const f=this.decode(row);if(f.tokenHash!==hash)throw new AppError('NOT_FOUND');return {reference:f.reference,deadline:null,timezone:FOUNDER_TIMEZONE,founderRateReserved:f.allocated,...founderPublicConfirmationState({confirmed:!!f.interest.confirmedAt,sentAt:f.interest.sentAt,deadline:f.interest.deadline,exception:f.interest.exception,status:f.status,now:this.clock.now()})};});}
 async confirm(token:string){const hash=tokenDigest(token);return this.db.transaction(async tx=>{
  await lockWorkspace(tx,this.workspace);
  const rows=await tx.query<Row>(select+' WHERE workspace_id=$1 AND token_digest=$2 FOR UPDATE',[this.workspace,hash]);const matches=rows.map(r=>this.decode(r)).filter(f=>f.tokenHash===hash);
  if(matches.length!==1)throw new AppError('NOT_FOUND');const f=matches[0]!;
  if(['expired','withdrawn'].includes(f.status))throw new AppError('CONFLICT');
  if(f.interest.confirmedAt)return {confirmed:true,alreadyConfirmed:true,reference:f.reference,founderRateReserved:f.allocated};
  if(!f.interest.sentAt||f.interest.exception||['expired','withdrawn'].includes(f.status))throw new AppError('CONFLICT');
  f.interest.confirmedAt=this.clock.now().toISOString();if(f.status==='provisional')f.status='confirmed';
  await this.cancelQueued(tx,f);await this.queue(tx,f,'ack',`ack:${f.interest.generation}`);await this.save(tx,f);await this.event(tx,f,'confirm_interest',null,'Explicit token POST; mailbox control only, not guardian/admission authority');return {confirmed:true,alreadyConfirmed:false,reference:f.reference,founderRateReserved:f.allocated};
 });}
 async ownerList(actor:Actor){if(actor.workspaceId!==this.workspace)throw new AppError('FORBIDDEN');return this.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');requirePractitioner(await freshActor(tx,actor,this.clock.now()));const rows=await tx.query<Row>(select+' WHERE workspace_id=$1 ORDER BY submission_sequence',[this.workspace]);const families=rows.map(r=>this.decode(r));const messages=await tx.query<{id:string;familyId:string;state:string;purpose:string;sentAt:Date|null}>(`SELECT id,founder_id AS "familyId",state,purpose,completed_at AS "sentAt" FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND founder_id IS NOT NULL ORDER BY created_at`,[this.workspace]);return {signupEmailReview:signupEmailReview(),organicCaptionReview:this.campaign().captionReview(),attribution:await this.campaign().attributionSummary(tx,families.filter(f=>f.identityApproved).map(f=>f.id)),campaign:await this.campaign().snapshot(tx),shares:await this.campaign().list(tx),reminderSchedule:PAYMENT_REMINDER_SCHEDULE,families,messages,nativeBindingReady:this.nativeFamilies!==null,offerIntegrationReady:this.paymentPort!==null,metrics:{completedRegistrations:(await tx.query<{n:number}>('SELECT count(*)::int AS n FROM ls_service_interest.academy_founder_applications WHERE workspace_id=$1',[this.workspace]))[0]!.n,uniqueFamilies:families.filter(f=>f.identityApproved).length,unresolvedIdentityRecords:families.filter(f=>!f.identityApproved).length,children:families.reduce((n,f)=>n+f.children.length,0),activeFounderReservations:families.filter(f=>f.allocated).length,confirmedInterest:families.filter(f=>f.interest.confirmedAt).length,waitingForSuitableGroup:families.filter(f=>f.status==='confirmed'||f.status==='scheduling_hold').length,offersSent:families.filter(f=>f.payment.sentAt).length,paidFamilies:families.filter(f=>f.everPaid||f.redeemedChildIds.length).length,paidChildren:families.reduce((n,f)=>n+f.redeemedChildIds.length,0),collectedCents:families.reduce((n,f)=>n+f.collectedCents,0),confirmedEnrollment:families.reduce((n,f)=>n+f.enrolledChildIds.length,0)}};});}
 async execute(actor:Actor,input:FounderOwnerCommand){const parsed=founderOwnerCommandSchema.safeParse(input);if(!parsed.success)throw new AppError('INVALID_REQUEST');const c=parsed.data;if(actor.workspaceId!==this.workspace)throw new AppError('FORBIDDEN');return this.db.transaction(async tx=>{
  await lockWorkspace(tx,this.workspace);requirePractitioner(await freshActor(tx,actor,this.clock.now()));const digest=this.digest(c);
  // Cached receipts never bypass current native identity/guardian authority.
  const native=c.action==='bind_native_family'?await this.readNative(tx,actor,await this.get(tx,c.familyId),c.binding):null;
  const prior=await one<{digest:string;result:string}>(tx,'SELECT request_digest AS digest,result_ciphertext AS result FROM ls_service_interest.academy_founder_operations WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3',[this.workspace,actor.id,c.operationId]);
  if(prior){if(prior.digest!==digest)throw new AppError('CONFLICT');return JSON.parse(unseal(prior.result,this.aad(c.operationId),this.ring)) as {saved:true;familyId:string;revision:number};}
  const f=await this.get(tx,c.familyId);if(c.expectedRevision!==f.revision)throw new AppError('CONFLICT');let transitionPurpose:FounderTransitionPurpose={kind:'other'};
  if(c.action==='bind_native_family'){
   if(!native)throw new AppError('UNAVAILABLE');
   if(f.nativeBinding&&(f.nativeBinding.householdId!==native.householdId||f.nativeBinding.parentAccountId!==native.parentAccountId||f.nativeBinding.source.personId!==native.source.personId))throw new AppError('CONFLICT');
   const other=await one(tx,'SELECT id FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1 AND native_household_id=$2 AND id<>$3 FOR UPDATE',[this.workspace,native.householdId,f.id]);if(other)throw new AppError('CONFLICT');
   f.nativeBinding=native;
  }
  if(c.action==='pause'){f.paused=true;await this.cancelQueued(tx,f);}
  if(c.action==='resume')f.paused=false;
  if(c.action==='resend'){
   const w=f[c.window];if(w.exception||f.paused||['expired','withdrawn','scheduling_hold'].includes(f.status)||c.window==='interest'&&w.confirmedAt||c.window==='payment'&&!f.offer)throw new AppError('CONFLICT');
   const kind=c.window==='interest'?'interest':'offer';
   // A fresh token is safe only after every prior in-flight result is resolved.
   if(await this.hasUnknown(tx,f,c.window==='payment'))throw new AppError('CONFLICT');
   await this.cancelQueued(tx,f);await this.queue(tx,f,kind,`resend:${c.operationId}`);
  }
  if(c.action==='resolve_identity'){if(f.status!=='pending_verification')throw new AppError('CONFLICT');f.identityApproved=c.outcome==='distinct_family';f.status=f.identityApproved?'interest_list':'withdrawn';}
  if(c.action==='scheduling_hold'){
   if(!f.interest.confirmedAt||!f.allocated||!occupiesFounder(f.status)||f.status==='redeemed')throw new AppError('CONFLICT');
   if(f.offer&&!await this.closeOffer(tx,f))throw new AppError('CONFLICT');
   f.status='scheduling_hold';f.payment={...emptyWindow(),generation:f.payment.generation+1};f.offer=null;await this.cancelQueued(tx,f);
  }
  if(c.action==='request_offer_closure'){
   if(!f.offer||!['offered','redeemed'].includes(f.status)||!this.paymentPort?.requestClosure||!await this.paymentPort.requestClosure(tx,f,{operatorId:actor.id,reason:c.reason}))throw new AppError('UNAVAILABLE');
   f.paused=true;await this.cancelQueued(tx,f);
  }
  if(c.action==='withdraw'){
   if(f.everPaid||f.redeemedChildIds.length||f.offer&&!await this.closeOffer(tx,f))throw new AppError('CONFLICT');
   f.status='withdrawn';f.allocated=false;await this.cancelQueued(tx,f);f.tokenHash=null;
  }
  if(c.action==='extend'){
   if(c.window==='interest')throw new AppError('CONFLICT'); // Initial interest has no expiry to extend.
   const w=f[c.window];if(!w.sentAt||w.exception||!w.deadline||new Date(c.deadline)<=new Date(w.deadline)||c.window==='payment'&&(!f.offer||new Date(c.deadline)>new Date(f.offer.firstSession)))throw new AppError('CONFLICT');
   if(c.window==='payment'&&(!f.offer||!this.paymentPort?.extendWindow||!await this.activatePayment(tx,f,c.deadline,w.deadline)))throw new AppError('UNAVAILABLE');
   w.deadline=c.deadline;await this.cancelQueued(tx,f);
  }
  if(c.action==='approve_offer'){
   if(!this.paymentPort)throw new AppError('UNAVAILABLE');if(!f.nativeBinding)throw new AppError('CONFLICT');await this.readNative(tx,actor,f,f.nativeBinding.source);if(!f.interest.confirmedAt||!['confirmed','scheduling_hold','interest_list'].includes(f.status)||new Date(c.firstSession)<=floridaCalendarDays(this.clock.now(),7))throw new AppError('CONFLICT');
   const expectedAmounts=f.children.map((child,i)=>({id:child.id,amount:founderPrice(c.plan,f.allocated,i>0)}));
   const offer=await this.paymentPort.approve(tx,actor,f,{groupId:c.groupId,firstSession:c.firstSession,plan:c.plan,expectedAmounts});
   if(offer.groupId!==c.groupId||offer.firstSession!==c.firstSession||!offer.terms||!offer.priceVersion||offer.children.length!==expectedAmounts.length||offer.children.some((p,i)=>p.id!==expectedAmounts[i]?.id||p.amount!==expectedAmounts[i]?.amount)||new URL(offer.paymentUrl).protocol!=='https:')throw new AppError('UNAVAILABLE');
   f.offer=offer;f.payment={...emptyWindow(),generation:f.payment.generation+1};f.status='offered';await this.cancelQueued(tx,f);await this.queue(tx,f,'offer',`offer:${f.payment.generation}`);transitionPurpose={kind:'commercial_template_approved',ownerId:actor.id,operationId:c.operationId,offerId:offer.id,generation:f.payment.generation,templateSha256:this.transitions().templateHash(offer)};
  }
  if(c.action==='delivery_review')transitionPurpose=await this.deliveryReview(tx,f,c,actor.id);
  await this.save(tx,f,transitionPurpose);await this.event(tx,f,c.action,actor.id,c.reason);await this.promote(tx);
  const result={saved:true as const,familyId:f.id,revision:f.revision};await tx.query('INSERT INTO ls_service_interest.academy_founder_operations(workspace_id,actor_id,operation_id,request_digest,family_id,result_ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[this.workspace,actor.id,c.operationId,digest,f.id,seal(JSON.stringify(result),this.aad(c.operationId),this.ring)]);return result;
 });}
 /** Private server preparation only, in the caller's existing transaction.
  * This supplies no offer/merchant/worker authority and changes no allocation. */
 async commercialContextInTransaction(tx:SqlSession,actor:Actor,familyId:string,expectedRevision:number):Promise<FounderCommercialFamily>{
  if(actor.workspaceId!==this.workspace)throw new AppError('FORBIDDEN');await lockWorkspace(tx,this.workspace);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
  const f=await this.get(tx,familyId);if(f.revision!==expectedRevision||!f.nativeBinding||f.paused)throw new AppError('CONFLICT');
  const native=await this.readNative(tx,actor,f,f.nativeBinding.source),row=await one<{allocated:boolean}>(tx,'SELECT allocated FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1 AND id=$2',[this.workspace,f.id]);
  if(!row||row.allocated!==f.allocated)throw new AppError('UNAVAILABLE');
  return {familyId:f.id,revision:f.revision,allocated:f.allocated,status:f.status,source:native.source,householdId:native.householdId,parentAccountId:native.parentAccountId,children:native.children};
 }
 /** Internal ordinary-owner read only; the separate facts verifier must still
  * prove its saved anchor and current native authority. This is not a grant. */
 async readForContinuationReviewInTransaction(tx:SqlSession,actor:Actor,familyId:string){
  if(actor.workspaceId!==this.workspace)throw new AppError('FORBIDDEN');await lockWorkspace(tx,this.workspace);requirePractitioner(await freshActor(tx,actor,this.clock.now()));return this.get(tx,familyId);
 }
 /** Narrow parent snapshot for document assent only. The consumer must verify
  * every current native guardian and inquiry binding. This is not owner lead
  * authority; commercial use still calls commercialContextInTransaction. */
 async commercialParentContextInTransaction(tx:SqlSession,actor:Actor,familyId:string,expectedRevision:number):Promise<FounderCommercialFamily>{
  if(actor.workspaceId!==this.workspace)throw new AppError('FORBIDDEN');await lockWorkspace(tx,this.workspace);
  const account=await freshActor(tx,actor,this.clock.now());if(account.role!=='parent'||!account.emailVerifiedAt)throw new AppError('FORBIDDEN');
  const f=await this.get(tx,familyId),b=f.nativeBinding;
  if(!b||b.parentAccountId!==actor.id)throw new AppError('NOT_FOUND');
  if(f.revision!==expectedRevision||f.paused||!f.identityApproved||!f.interest.confirmedAt||!['confirmed','scheduling_hold','interest_list'].includes(f.status))throw new AppError('CONFLICT');
  if(b.children.length!==f.children.length||f.children.some((c,i)=>b.children[i]?.registrationChildId!==c.id)||new Set(b.children.map(c=>c.learnerId)).size!==f.children.length)throw new AppError('UNAVAILABLE');
  return {familyId:f.id,revision:f.revision,allocated:f.allocated,status:f.status,source:b.source,householdId:b.householdId,parentAccountId:b.parentAccountId,children:b.children};
 }
 private async readNative(tx:SqlSession,actor:Actor,f:FounderFamily,source:FounderNativeFamily['source']){
  if(!this.nativeFamilies)throw new AppError('UNAVAILABLE');
  if(!f.identityApproved||!f.interest.confirmedAt||!['confirmed','scheduling_hold','interest_list'].includes(f.status))throw new AppError('CONFLICT');
  if(!await one(tx,'SELECT application_id FROM ls_service_interest.academy_founder_applications WHERE workspace_id=$1 AND application_id=$2 AND family_id=$3',[this.workspace,source.applicationId,f.id]))throw new AppError('CONFLICT');
  const native=await this.nativeFamilies.read(tx,actor,f,source);
  if(native.source.applicationId!==source.applicationId||native.source.personId!==source.personId||native.verifiedBy!==actor.id||native.children.length!==f.children.length||new Set(native.children.map(c=>c.registrationChildId)).size!==f.children.length||new Set(native.children.map(c=>c.learnerId)).size!==f.children.length||f.children.some(c=>!native.children.some(n=>n.registrationChildId===c.id)))throw new AppError('CONFLICT');
  if(f.nativeBinding&&(f.nativeBinding.householdId!==native.householdId||f.nativeBinding.parentAccountId!==native.parentAccountId||f.nativeBinding.source.personId!==native.source.personId||f.nativeBinding.children.some(old=>native.children.find(c=>c.registrationChildId===old.registrationChildId)?.learnerId!==old.learnerId)))throw new AppError('CONFLICT');
  return native;
 }
 /** Only a matching durable SENT row can authorize activation. Provider I/O
  * never occurs here; UNKNOWN or reviewed-but-not-recorded receipts stay closed. */
 private async activatePayment(tx:SqlSession,f:FounderFamily,deadline:string,previousDeadline?:string){
  if(!f.offer||!this.paymentPort||!f.payment.sentAt)return false;
  const rows=await tx.query<{id:string;providerId:string|null;payload:string}>("SELECT id,provider_id AS \"providerId\",payload_ciphertext AS payload FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND founder_id=$2 AND purpose='academy_founder_offer' AND state='sent' AND completed_at=$3 ORDER BY created_at,id",[this.workspace,f.id,f.payment.sentAt]);
  for(const row of rows){const message=JSON.parse(unseal(row.payload,`ls_service_interest/inquiry_email/v1/${this.workspace}/${row.id}`,this.ring)) as FounderMail;if(message.familyId!==f.id||message.kind!=='offer'||message.generation!==f.payment.generation||!row.providerId||!/^[A-Za-z0-9_-]{1,256}$/.test(row.providerId))continue;
   const evidence:FounderActivationWindow={sentAt:f.payment.sentAt,deadline,timezone:FOUNDER_TIMEZONE,messageId:row.id,providerId:row.providerId,generation:f.payment.generation};
   return previousDeadline?Boolean(await this.paymentPort.extendWindow?.(tx,f,f.offer,{...evidence,previousDeadline})):this.paymentPort.activateWindow(tx,f,f.offer,evidence);
  }return false;
 }
 private paymentProjection(f:FounderFamily,p:{paidChildIds:string[];collectedCents:number;enrolledChildIds:string[]}){
  const children=f.offer?.children??[],ids=children.map(c=>c.id),paid=p.paidChildIds,enrolled=p.enrolledChildIds;
  if(!Array.isArray(paid)||!Array.isArray(enrolled)||new Set(paid).size!==paid.length||new Set(enrolled).size!==enrolled.length||paid.some(id=>!ids.includes(id))||enrolled.some(id=>!paid.includes(id))||!Number.isSafeInteger(p.collectedCents)||p.collectedCents<Math.max(0,f.collectedCents)||f.redeemedChildIds.some(id=>!paid.includes(id))||p.collectedCents>children.reduce((n,c)=>n+c.amount*100,0)||p.collectedCents<children.filter(c=>paid.includes(c.id)).reduce((n,c)=>n+c.amount*100,0))throw new AppError('UNAVAILABLE');
  if(p.collectedCents>0||paid.length)f.everPaid=true;
  f.redeemedChildIds=[...new Set([...f.redeemedChildIds,...paid])];f.collectedCents=p.collectedCents;f.enrolledChildIds=enrolled;
 }
 private async closeOffer(tx:SqlSession,f:FounderFamily){if(!this.paymentPort)return false;const p=await this.paymentPort.reconcileAndClose(tx,f);if(typeof p.safeToRelease!=='boolean')throw new AppError('UNAVAILABLE');this.paymentProjection(f,p);if(f.everPaid||f.redeemedChildIds.length||f.collectedCents>0){f.status='redeemed';return false;}return p.safeToRelease;}
 private async promote(tx:SqlSession,population?:SignupWorkerAdmission){let count=await this.occupied(tx);if(count>=FOUNDER_CAPACITY)return;const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND status='interest_list' ORDER BY submission_sequence FOR UPDATE",[this.workspace]);for(const row of rows){if(count>=FOUNDER_CAPACITY)break;const f=this.decode(row);if(!f.identityApproved||paymentFamily(f)||f.paused)continue;
   // Do not mutate excluded families or bypass an older eligible FIFO family.
   if(population){assertSignupWorkerAdmission(population,this.workspace,this.clock.now());if(!signupWorkerFamilyAllowed(population,f,this.clock.now()))break;}
   f.status='provisional';f.allocated=true;f.interest={...emptyWindow(),generation:f.interest.generation+1};f.tokenHash=null;await this.cancelQueued(tx,f,population?'signup':'all');await this.queue(tx,f,'interest',`promotion:${f.interest.generation}`);await this.save(tx,f);await this.event(tx,f,'promotion',null,'FIFO completed-form applicant; new confirmation request');count++;}}
 private async deliveryReview(tx:SqlSession,f:FounderFamily,c:Extract<FounderOwnerCommand,{action:'delivery_review'}>,ownerId:string):Promise<FounderTransitionPurpose>{
  const row=await one<{state:string;payload:string}>(tx,'SELECT state,payload_ciphertext AS payload FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND founder_id=$2 AND id=$3 FOR UPDATE',[this.workspace,f.id,c.messageId]);if(!row||!['unknown','sent'].includes(row.state))throw new AppError('CONFLICT');
  const p=JSON.parse(unseal(row.payload,`ls_service_interest/inquiry_email/v1/${this.workspace}/${c.messageId}`,this.ring)) as FounderMail,w=paymentKind(p.kind)?f.payment:f.interest;
  if(p.generation!==w.generation)throw new AppError('CONFLICT');const wasUnsent=w.sentAt===null;
  if(paymentKind(p.kind)&&c.outcome==='not_sent'&&w.sentAt&&!await this.closeOffer(tx,f))throw new AppError('CONFLICT');
  if(c.outcome==='sent'){
   if(!c.sentAt||!c.providerId||new Date(c.sentAt)>this.clock.now())throw new AppError('INVALID_REQUEST');
   if(!w.sentAt){w.sentAt=c.sentAt;if(paymentKind(p.kind))w.deadline=floridaCalendarDays(new Date(c.sentAt),7).toISOString();}w.exception=false;delete w.deliveryOutcome;
   await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',provider_id=$4,completed_at=$5 WHERE workspace_id=$1 AND founder_id=$2 AND id=$3",[this.workspace,f.id,c.messageId,c.providerId,c.sentAt]);
   if(p.kind==='offer'&&(!f.offer||new Date(w.deadline!)>new Date(f.offer.firstSession)||!await this.activatePayment(tx,f,w.deadline!)))w.exception=true;
   if(!w.exception&&p.kind==='offer')await this.queue(tx,f,'payment_deadline_receipt',`deadline:${p.kind}:${w.generation}`);
  }else{w.exception=true;w.deliveryOutcome=c.outcome==='bounce'||c.outcome==='suppressed'?'failed':'unknown';await this.cancelQueued(tx,f);if(c.outcome==='not_sent'){w.sentAt=null;w.deadline=null;w.exception=false;delete w.deliveryOutcome;w.generation++;await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='canceled',provider_id=NULL,completed_at=$4 WHERE workspace_id=$1 AND founder_id=$2 AND id=$3",[this.workspace,f.id,c.messageId,this.clock.now()]);}}
  return c.outcome==='sent'&&p.kind==='offer'&&wasUnsent&&!w.exception&&!f.paused&&f.status==='offered'?this.sentPurpose(f,c.messageId,c.providerId!,ownerId):{kind:'other'};
 }
 private async unreserveNotAttempted(id:string,familyId:string,reservedAt:Date){
  await this.db.transaction(async tx=>{
     await lockWorkspace(tx,this.workspace);
     const restored=await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='queued',reserved_at=NULL WHERE workspace_id=$1 AND id=$2 AND state='unknown' AND reserved_at=$3 AND provider_id IS NULL AND completed_at IS NULL RETURNING id",[this.workspace,id,reservedAt]);
     const family=await this.get(tx,familyId);
     await this.event(tx,family,'dispatch_not_attempted',null,JSON.stringify({messageId:id,reason:'Local admission/adapter fence rejected before provider invocation',reservationRestored:restored.length===1}));
    });
 }
 /** Dispatch uses existing transport and existing outbox. Caller enforces send enablement. */
 async dispatchOne(id:string,transport:AuthEmailTransport,from:string,origin:string,scope:FounderMailScope='all',population?:SignupWorkerAdmission){
  if(population){assertSignupWorkerAdmission(population,this.workspace,this.clock.now());if(scope!=='signup'||origin!==population.origin||from!==population.sender)throw new AppError('UNAVAILABLE');}
  if(!['signup','all'].includes(scope)||from!==INQUIRY_EMAIL_FROM||new URL(origin).protocol!=='https:')throw new AppError('UNAVAILABLE');
  const prepared=await this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspace);const row=await one<{familyId:string;state:string;payload:string}>(tx,'SELECT founder_id AS "familyId",state,payload_ciphertext AS payload FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspace,id]);if(!row||row.state!=='queued'||!row.familyId)return null;
   const f=await this.get(tx,row.familyId),p=JSON.parse(unseal(row.payload,`ls_service_interest/inquiry_email/v1/${this.workspace}/${id}`,this.ring)) as StoredFounderMail,w=paymentKind(p.kind)?f.payment:f.interest;
   if(p.heldSignupContent)return null; // Historical content cannot fall through to any legacy or current transport.
   if(f.signupContent!==undefined&&!paymentKind(p.kind)&&(!p.transactional||!academyRecordedCommunicationPreferencesSchema.safeParse(f.communicationPreferences).success))return null; // New exact family cannot fall through legacy/UI-language send.
   if(p.transactional&&!academyRecordedCommunicationPreferencesSchema.safeParse(f.communicationPreferences).success)return null; // All exact05 payloads require recorded parent-message language.
   if(p.transactional&&!population)return null; // Exact-copy payloads never use an unscoped legacy dispatch.
   // Admission is rechecked under the same lock before reserving or changing a row.
   if(population){assertSignupWorkerAdmission(population,this.workspace,this.clock.now());if(!signupWorkerFamilyAllowed(population,f,this.clock.now())||p.reference!==f.reference||!signupWorkerMessageAllowed(population,{version:p.transactional?.version,templateId:p.transactional?.templateId,templateCatalogSha256:p.templateCatalogSha256,...(p.transactional?.r00Exception?{r00Exception:p.transactional.r00Exception}:{})},this.clock.now()))return null;
    if(population.population.mode==='controlled_test'&&(p.generation!==population.population.generation||!f.identityApproved||!academyRecordedCommunicationPreferencesSchema.safeParse(f.communicationPreferences).success))return null;
    p.status=f.status==='pending_verification'?'pending_verification':f.allocated?'reserved':'interest_list';
    if(p.transactional?.templateId==='R03'){if(!f.interest.confirmedAt)return null;p.transactional={...p.transactional,confirmed:true,founderRateReserved:f.allocated};}
    else if(isAnnouncementR00(p)){if(w.sentAt||w.deadline||w.confirmedAt||p.transactional!.acceptedSend!==undefined)return null;}
    else if(p.transactional){if(!w.sentAt)return null;p.transactional={...p.transactional,acceptedSend:{sentAt:w.sentAt}};}
   }
   // Signup activation cannot reserve, cancel or otherwise mutate held payment work.
   if(scope==='signup'&&(!signupMailPurposes.includes('academy_founder_'+p.kind)||paymentFamily(f)))return null;
   if(paymentKind(p.kind)&&p.kind!=='payment_reminder'&&(!this.paymentPort||!await this.paymentCurrent(tx,f))){await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='canceled',completed_at=$3 WHERE workspace_id=$1 AND id=$2",[this.workspace,id,this.clock.now()]);await this.save(tx,f);return null;}
   if(p.kind==='payment_reminder'){
    const lines=await this.reminderLines(tx,f);if(!lines?.length||p.reminderDate!==floridaDate(this.clock.now())){await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='canceled',completed_at=$3 WHERE workspace_id=$1 AND id=$2",[this.workspace,id,this.clock.now()]);await this.save(tx,f);return null;}
    await this.save(tx,f);p.unpaidLines=lines;p.offer=f.offer!;await tx.query('UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[this.workspace,id,seal(JSON.stringify(p),`ls_service_interest/inquiry_email/v1/${this.workspace}/${id}`,this.ring)]);await this.event(tx,f,'daily_reminder_revalidated',null,p.reminderDate);
   }
   if(p.familyId!==f.id||p.to!==f.email||f.paused||w.exception||p.generation!==w.generation||['withdrawn','expired','scheduling_hold'].includes(f.status)||p.kind==='interest_reminder'&&(w.confirmedAt||f.status==='redeemed')){await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='canceled',completed_at=$3 WHERE workspace_id=$1 AND id=$2",[this.workspace,id,this.clock.now()]);return null;}
   const sentAt=this.clock.now();if(p.kind==='offer'&&(!f.offer||floridaCalendarDays(sentAt,7)>new Date(f.offer.firstSession))){w.exception=true;await this.save(tx,f);return null;}
   const mail=founderEmailContent({...p,...(w.deadline?{deadline:w.deadline}:{})},origin);
   await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='unknown',reserved_at=$3 WHERE workspace_id=$1 AND id=$2",[this.workspace,id,sentAt]);
   // Only the later verified group/start-date announcement offer starts payment.
   // An initial receipt records successful SEND without any interest-expiry clock.
   return {familyId:f.id,revision:f.revision,p,at:sentAt,mail};
  });if(!prepared)return 'idle' as const;
  // Commit can settle after the admission window closes. No await may occur
  // between this fresh fence and starting the provider call below.
  if(population){
   try{assertSignupWorkerAdmission(population,this.workspace,this.clock.now());}
   catch{
    // No provider call has begun: release only our still-unchanged reservation.
    // A concurrent owner cancellation/reconciliation must never be overwritten.
    // If this transaction fails, propagate the persistence failure; do not emit
    // send_exception or pretend that an ambiguous provider call occurred.
    await this.unreserveNotAttempted(id,prepared.familyId,prepared.at);return 'idle' as const;
   }
  }
  try{
   const receipt=await transport.send({from,to:prepared.p.to,...prepared.mail,idempotencyKey:`ls-auth-${id}`});if(!/^[A-Za-z0-9_-]{1,256}$/.test(receipt.providerId))throw Error();
   await this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);const f=await this.get(tx,prepared.familyId),w=paymentKind(prepared.p.kind)?f.payment:f.interest;let transitionPurpose:FounderTransitionPurpose={kind:'other'};const wasUnsent=w.sentAt===null;
    const completed=this.clock.now(),recorded=await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',provider_id=$3,completed_at=$4 WHERE workspace_id=$1 AND id=$2 AND state='unknown' RETURNING id",[this.workspace,id,receipt.providerId,completed]);
    if(recorded.length===1&&w.generation===prepared.p.generation&&['interest','offer'].includes(prepared.p.kind)&&!(scope==='signup'&&paymentFamily(f))){
     if(f.revision!==prepared.revision||f.paused||['withdrawn','expired','scheduling_hold'].includes(f.status))w.exception=true;
     else if(!w.sentAt){w.sentAt=completed.toISOString();if(prepared.p.kind==='offer')w.deadline=floridaCalendarDays(completed,7).toISOString();if(prepared.p.kind==='offer'&&(!f.offer||new Date(w.deadline!)>new Date(f.offer.firstSession)||!await this.activatePayment(tx,f,w.deadline!)))w.exception=true;if(!w.exception&&prepared.p.kind==='offer')await this.queue(tx,f,'payment_deadline_receipt',`deadline:${prepared.p.kind}:${w.generation}`);}
     if(prepared.p.kind==='offer'&&wasUnsent&&!w.exception&&w.sentAt===completed.toISOString())transitionPurpose=this.sentPurpose(f,id,receipt.providerId,null);
     await this.save(tx,f,transitionPurpose);
    }await this.event(tx,f,'provider_accepted',null,JSON.stringify({messageId:id,providerId:receipt.providerId,sentAt:completed.toISOString(),generation:prepared.p.generation,outboxReceiptUpdated:recorded.length===1,note:'Not read/delivery proof; immutable late receipt even if row was canceled'}));
   });return 'sent' as const;
  }catch(error){if(error instanceof SignupEmailNotAttemptedError){await this.unreserveNotAttempted(id,prepared.familyId,prepared.at);return 'idle' as const;}await this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);const f=await this.get(tx,prepared.familyId);const w=paymentKind(prepared.p.kind)?f.payment:f.interest;if(w.generation===prepared.p.generation&&!(scope==='signup'&&paymentFamily(f))){w.exception=true;await this.cancelQueued(tx,f,scope);await this.save(tx,f);}await this.event(tx,f,'send_exception',null,'Unknown/ambiguous; no automatic retry or forfeiture');});return 'unknown' as const;}
 }
 /** Safe due-work preparation. No provider call; scheduler runs this before dispatch. */
 private async reminderLines(tx:SqlSession,f:FounderFamily){
  if(!f.offer||!this.paymentPort?.reminderProjection||!f.payment.sentAt||f.payment.exception||f.paused)return null;
  const money=await this.paymentPort.inspect(tx,f);this.paymentProjection(f,money);if(money.inFlight)return [];
  return currentReminderLines(await this.paymentPort.reminderProjection(tx,f),f,this.clock.now());
 }
 async tick(reminderDays:readonly number[]=FOUNDER_REMINDER_DEFAULTS,paymentHour:number=PAYMENT_REMINDER_SCHEDULE.hour,scope:FounderMailScope='all',population?:SignupWorkerAdmission){if(population){assertSignupWorkerAdmission(population,this.workspace,this.clock.now());if(scope!=='signup'||reminderDays.some(day=>day!==3&&day!==6))throw new AppError('INVALID_REQUEST');}if(!['signup','all'].includes(scope)||reminderDays.some(d=>!Number.isInteger(d)||d<1||d>6)||!Number.isInteger(paymentHour)||paymentHour<0||paymentHour>23)throw new AppError('INVALID_REQUEST');if(population?.population.mode==='controlled_test')return {prepared:false};return this.db.transaction(async tx=>{
  await lockWorkspace(tx,this.workspace);const rows=await tx.query<Row>(select+' WHERE workspace_id=$1 AND ($2::timestamptz IS NULL OR submitted_at >= $2) AND ($3::uuid[] IS NULL OR application_id=ANY($3)) ORDER BY submission_sequence FOR UPDATE',[this.workspace,population?.cutoff??null,population?signupWorkerReferences(population):null]);
  for(const row of rows){const f=this.decode(row);if(population){assertSignupWorkerAdmission(population,this.workspace,this.clock.now());if(!signupWorkerFamilyAllowed(population,f,this.clock.now()))continue;}if(scope==='signup'&&paymentFamily(f))continue;if(f.paused||['expired','withdrawn','scheduling_hold','pending_verification'].includes(f.status))continue;
   const payment=!!f.offer,w=payment?f.payment:f.interest;
   if(payment){const current=await this.paymentCurrent(tx,f);if(!current&&!f.everPaid){await this.cancelQueued(tx,f);await this.save(tx,f);continue;}}
   if(w.exception||!w.sentAt||payment&&!w.deadline||!payment&&w.confirmedAt)continue;
   if(await this.hasUnknown(tx,f,payment)){w.exception=true;await this.save(tx,f);continue;}
   // Historical initial-interest deadlines are audit only. They never expire a reservation.
   if(payment&&new Date(w.deadline!)<=this.clock.now()){
    if(payment&&!await this.closeOffer(tx,f)){w.exception=true;await this.save(tx,f);continue;}
    f.status='expired';f.allocated=false;f.tokenHash=null;await this.cancelQueued(tx,f,population?'signup':'all');await this.save(tx,f);await this.event(tx,f,'expired',null,'Successfully sent window elapsed; unused allocation released once');
   }else if(payment){
    const date=floridaDate(this.clock.now()),hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:FOUNDER_TIMEZONE,hour:'2-digit',hourCycle:'h23'}).format(this.clock.now()));
    // Cancel obsolete dates; never enqueue missed-day catch-up messages.
    const queued=await tx.query<{id:string;ciphertext:string}>(txMailSelect+" WHERE workspace_id=$1 AND founder_id=$2 AND purpose='academy_founder_payment_reminder' AND state='queued'",[this.workspace,f.id]);
    for(const row of queued){const old=JSON.parse(unseal(row.ciphertext,`ls_service_interest/inquiry_email/v1/${this.workspace}/${row.id}`,this.ring)) as FounderMail;if(old.reminderDate!==date)await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='canceled',completed_at=$3 WHERE workspace_id=$1 AND id=$2",[this.workspace,row.id,this.clock.now()]);}
    const lines=await this.reminderLines(tx,f);if(hour>=paymentHour&&lines?.length)await this.queue(tx,f,'payment_reminder',`payment:family-date:${date}`,{reminderDate:date,unpaidLines:lines});await this.save(tx,f);
   }else for(const day of reminderDays)if(floridaCalendarDays(new Date(w.sentAt),day)<=this.clock.now())await this.queue(tx,f,'interest_reminder',`interest:${w.generation}:reminder:${day}`,undefined,day===3||day===6?day:undefined);
  }await this.promote(tx,population);return {prepared:true};
 });}
 async dispatchQueued(transport:AuthEmailTransport,from:string,origin:string,scope:FounderMailScope='all',population?:SignupWorkerAdmission,after?:SignupDispatchCursor){
  if(population){assertSignupWorkerAdmission(population,this.workspace,this.clock.now());if(scope!=='signup'||origin!==population.origin||from!==population.sender)throw new AppError('INVALID_REQUEST');}
  if(!['signup','all'].includes(scope))throw new AppError('INVALID_REQUEST');
  if(after&&(!population||typeof after.createdAt!=='string'||after.createdAt.length>64||!Number.isFinite(Date.parse(after.createdAt))||!/^[-0-9a-f]{36}$/.test(after.id)))throw new AppError('INVALID_REQUEST');
  // Keep the exact PostgreSQL timestamp text, including microseconds. Reading
  // one extra row proves whether the bounded page has reached its current end.
  const rows=await this.db.transaction(tx=>tx.query<{id:string;createdAt:string}>("SELECT m.id,m.created_at::text AS \"createdAt\" FROM ls_service_interest.inquiry_email_outbox m JOIN ls_service_interest.academy_founder_families f ON f.workspace_id=m.workspace_id AND f.id=m.founder_id WHERE m.workspace_id=$1 AND m.state='queued' AND ($2::boolean=false OR m.purpose IN ($3,$4,$5,$6)) AND ($7::timestamptz IS NULL OR f.submitted_at >= $7) AND ($8::uuid[] IS NULL OR f.application_id=ANY($8)) AND ($9::timestamptz IS NULL OR (m.created_at,m.id)>($9::timestamptz,$10::uuid)) ORDER BY m.created_at,m.id LIMIT 51",[this.workspace,scope==='signup',...signupMailPurposes,population?.cutoff??null,population?signupWorkerReferences(population):null,after?.createdAt??null,after?.id??null]));
  const page=rows.slice(0,50);let processed=0;
  for(const row of page){const result=await this.dispatchOne(row.id,transport,from,origin,scope,population);if(result!=='idle')processed++;}
  const last=page.at(-1),continuation:SignupDispatchCursor|undefined=population&&rows.length>50&&last?Object.freeze({createdAt:last.createdAt,id:last.id}):undefined;
  return {processed:population?processed:page.length,inspected:page.length,continuation,scanComplete:rows.length<=50};
 }
 async dispatchForApplication(reference:string,transport:AuthEmailTransport,from:string,origin:string,population?:SignupWorkerAdmission){
  if(population){assertSignupWorkerAdmission(population,this.workspace,this.clock.now());if(origin!==population.origin||from!==population.sender)throw new AppError('INVALID_REQUEST');}
  const rows=await this.db.transaction(tx=>tx.query<{id:string}>("SELECT m.id FROM ls_service_interest.inquiry_email_outbox m JOIN ls_service_interest.academy_founder_applications a ON a.workspace_id=m.workspace_id AND a.family_id=m.founder_id JOIN ls_service_interest.academy_founder_families f ON f.workspace_id=a.workspace_id AND f.id=a.family_id WHERE ($3::timestamptz IS NULL OR f.submitted_at >= $3) AND ($4::uuid[] IS NULL OR f.application_id=ANY($4)) AND a.workspace_id=$1 AND a.application_id=$2 AND m.state='queued' AND m.purpose IN('academy_founder_interest','academy_founder_ack') ORDER BY m.created_at LIMIT 2",[this.workspace,reference,population?.cutoff??null,population?signupWorkerReferences(population):null]));
  for(const row of rows)await this.dispatchOne(row.id,transport,from,origin,'signup',population);
  const receipts=await this.db.transaction(tx=>tx.query<{id:string}>("SELECT m.id FROM ls_service_interest.inquiry_email_outbox m JOIN ls_service_interest.academy_founder_applications a ON a.workspace_id=m.workspace_id AND a.family_id=m.founder_id JOIN ls_service_interest.academy_founder_families f ON f.workspace_id=a.workspace_id AND f.id=a.family_id WHERE ($3::timestamptz IS NULL OR f.submitted_at >= $3) AND ($4::uuid[] IS NULL OR f.application_id=ANY($4)) AND a.workspace_id=$1 AND a.application_id=$2 AND m.state='queued' AND m.purpose='academy_founder_interest_deadline_receipt' LIMIT 1",[this.workspace,reference,population?.cutoff??null,population?signupWorkerReferences(population):null]));for(const row of receipts)await this.dispatchOne(row.id,transport,from,origin,'signup',population);
 }
 private async paymentCurrent(tx:SqlSession,f:FounderFamily){if(!f.offer||!this.paymentPort)return false;const p=await this.paymentPort.inspect(tx,f);if(typeof p.inFlight!=='boolean')throw new AppError('UNAVAILABLE');this.paymentProjection(f,p);if(f.everPaid||f.redeemedChildIds.length||f.collectedCents>0){f.status='redeemed';return false;}return !p.inFlight;}
 /** Internal callback for the admitted signed-payment transaction coordinator. No public/owner raw PAID action. */
 async reconcilePayment(){return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND status IN('offered','redeemed') FOR UPDATE",[this.workspace]);for(const row of rows){const f=this.decode(row);await this.paymentCurrent(tx,f);if(!this.paymentPort?.reminderProjection)await this.cancelQueued(tx,f);await this.save(tx,f);}return {reconciled:true};});}
}
