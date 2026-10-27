import {createHash} from 'node:crypto';
import {z} from 'zod';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const timestamp=z.string().datetime({offset:false});
const schema=z.object({
 version:z.literal('JLFA-SIGNUP-WORKER-ADMISSION-v2'),approvalReceiptSha256:hash,
 sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),workspaceId:z.string().uuid(),
 projectId:z.string().uuid(),environmentId:z.string().uuid(),serviceId:z.string().uuid(),
 origin:z.enum(['https://bneineviimacademy.org','https://life-skills.bneineviimacademy.org']),
 sender:z.literal('office@bneineviimacademy.org'),templateModuleSha256:hash,
 templateContractSha256:hash,templateCatalogSha256:hash,templateFacadeSha256:hash,
 templateVersion:z.literal('JLFA-EXACT-COPY-20261026-05'),
 // Content approval is not send authority. Every population still requires its
 // issued finite source-bound admission and existing mode-specific runtime gates.
 r00Exception:z.object({version:z.literal('JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01'),approvalReceiptSha256:hash}).strict().optional(),
 allowedTemplateIds:z.array(z.enum(['R00','R01','R02','R03'])).min(1).max(4),
 transportHashes:z.object({gmail:hash,contract:hash,resend:hash}).strict(),
 cutoff:timestamp,expiresAt:timestamp,
 population:z.discriminatedUnion('mode',[
  z.object({mode:z.literal('future_submissions')}).strict(),
  z.object({mode:z.literal('controlled_test'),admittedAt:timestamp,recipientSha256:hash,learnerIds:z.array(z.string().uuid()).length(2)}).strict(),
  z.object({mode:z.literal('references'),families:z.array(z.object({reference:z.string().uuid(),recipientSha256:hash}).strict()).min(1).max(50)}).strict(),
 ]),
}).strict();
type Policy=z.infer<typeof schema>;
const issued=new WeakSet<object>();
/** Only the local guarded adapter raises this before any provider invocation. */
export class SignupEmailNotAttemptedError extends Error{constructor(){super('SIGNUP_EMAIL_NOT_ATTEMPTED');this.name='SignupEmailNotAttemptedError';}}
export type SignupWorkerAdmission=Readonly<Policy>;
export type SignupWorkerContext={enabled:boolean;freeEnabled:boolean;sendEnabled:boolean;founderApproved:boolean;sourceCommit:string;releaseCommit:string;workspaceId:string;projectId:string;environmentId:string;serviceId:string;origin:string;templateModuleSha256:string;templateContractSha256:string;templateCatalogSha256:string;templateFacadeSha256:string;templateVersion:string;transportHashes:{gmail:string;contract:string;resend:string}};
export function signupRecipientDigest(email:string){return createHash('sha256').update(email,'utf8').digest('hex');}
/** A private, source-bound owner admission receipt is required. Config parsing is
 * not owner approval; the receipt is supplied only through the existing release process. */
export function createSignupWorkerAdmission(input:unknown,context:SignupWorkerContext,now:Date):SignupWorkerAdmission|null{
 if(context.enabled!==true||context.freeEnabled!==true||context.sendEnabled!==true||!Number.isFinite(now.getTime()))return null;
 const parsed=schema.safeParse(input);if(!parsed.success)return null;const p=parsed.data;
 if(p.population.mode!=='controlled_test'&&context.founderApproved!==true)return null;
 if(p.sourceCommit!==context.sourceCommit||p.sourceCommit!==context.releaseCommit||p.workspaceId!==context.workspaceId||p.projectId!==context.projectId||p.environmentId!==context.environmentId||p.serviceId!==context.serviceId||p.origin!==context.origin||p.templateModuleSha256!==context.templateModuleSha256||p.templateContractSha256!==context.templateContractSha256||p.templateCatalogSha256!==context.templateCatalogSha256||p.templateFacadeSha256!==context.templateFacadeSha256||p.templateVersion!==context.templateVersion)return null;
 if(!context.transportHashes||(['gmail','contract','resend'] as const).some(key=>p.transportHashes[key]!==context.transportHashes[key]))return null;
 if(new Set(p.allowedTemplateIds).size!==p.allowedTemplateIds.length)return null;
 if(p.allowedTemplateIds.includes('R00')&&!p.r00Exception)return null;
 if(p.r00Exception&&p.r00Exception.approvalReceiptSha256!=='7dfc71f18f0f853bb11f4bc1de0547484c13a9bbfa1f82eeab30d0eaf95aca87')return null;
 if(p.population.mode==='controlled_test'){
  if(!p.r00Exception||!p.allowedTemplateIds.includes('R03')||p.allowedTemplateIds.some(id=>id!=='R00'&&id!=='R03')||new Set(p.population.learnerIds).size!==2||Date.parse(p.population.admittedAt)>now.getTime()||Date.parse(p.population.admittedAt)<Date.parse(p.cutoff)||Date.parse(p.expiresAt)<=Date.parse(p.population.admittedAt)||Date.parse(p.expiresAt)-Date.parse(p.population.admittedAt)>24*60*60*1000)return null;
  Object.freeze(p.population.learnerIds);
 }
 if(p.r00Exception)Object.freeze(p.r00Exception);
 if(Date.parse(p.cutoff)>now.getTime()||Date.parse(p.expiresAt)<=now.getTime()||Date.parse(p.expiresAt)<=Date.parse(p.cutoff))return null;
 if(p.population.mode==='references'){
  if(new Set(p.population.families.map(f=>f.reference)).size!==p.population.families.length)return null;
  for(const f of p.population.families)Object.freeze(f);Object.freeze(p.population.families);
 }
 Object.freeze(p.allowedTemplateIds);Object.freeze(p.transportHashes);Object.freeze(p.population);Object.freeze(p);issued.add(p);return p;
}
export function assertSignupWorkerAdmission(p:SignupWorkerAdmission,workspace:string,now:Date){
 if(!issued.has(p)||p.workspaceId!==workspace||!Number.isFinite(now.getTime())||now.getTime()<Date.parse(p.cutoff)||p.population.mode==='controlled_test'&&now.getTime()<Date.parse(p.population.admittedAt)||now.getTime()>=Date.parse(p.expiresAt))throw Error('SIGNUP_WORKER_NOT_ADMITTED');
}
export function signupWorkerReferences(p:SignupWorkerAdmission){return p.population.mode==='references'?p.population.families.map(f=>f.reference):null;}
export function signupWorkerFamilyAllowed(p:SignupWorkerAdmission,f:{reference:string;submittedAt:string;email:string;children?:readonly {id:string}[]},now:Date){
 if(!issued.has(p)||!Number.isFinite(now.getTime())||now.getTime()>=Date.parse(p.expiresAt))return false;
 const at=Date.parse(f.submittedAt);if(!Number.isFinite(at)||at<Date.parse(p.cutoff)||at>now.getTime())return false;
 if(p.population.mode==='controlled_test'){if(now.getTime()<Date.parse(p.population.admittedAt))return false;const ids=f.children?.map(c=>c.id);return p.population.recipientSha256===signupRecipientDigest(f.email)&&ids?.length===2&&new Set(ids).size===2&&ids.every(id=>p.population.mode==='controlled_test'&&p.population.learnerIds.includes(id));}
 return p.population.mode==='future_submissions'||p.population.families.some(a=>a.reference===f.reference&&a.recipientSha256===signupRecipientDigest(f.email));
}

/** Identity check only, not send authority. Caller must also check current family,
 * generation, recipient, original submission population and pre-transport expiry.
 * Existing payloads never gain this identity by inference or automatic upgrade. */
export function signupWorkerMessageAllowed(p:SignupWorkerAdmission,message:unknown,now:Date){
 if(!issued.has(p)||!Number.isFinite(now.getTime())||now.getTime()<Date.parse(p.cutoff)||now.getTime()>=Date.parse(p.expiresAt))return false;
 const parsed=z.object({version:z.literal('JLFA-EXACT-COPY-20261026-05'),templateId:z.enum(['R00','R01','R02','R03']),templateCatalogSha256:hash,r00Exception:z.object({version:z.literal('JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01'),approvalReceiptSha256:hash}).strict().optional()}).strict().safeParse(message);
 if(!parsed.success||p.population.mode==='controlled_test'&&now.getTime()<Date.parse(p.population.admittedAt))return false;
 const m=parsed.data;if(m.templateId==='R00'){if(!p.r00Exception||m.r00Exception?.version!==p.r00Exception.version||m.r00Exception.approvalReceiptSha256!==p.r00Exception.approvalReceiptSha256)return false;}else if(m.r00Exception!==undefined)return false;
 return parsed.data.version===p.templateVersion&&parsed.data.templateCatalogSha256===p.templateCatalogSha256&&p.allowedTemplateIds.includes(parsed.data.templateId);
}
