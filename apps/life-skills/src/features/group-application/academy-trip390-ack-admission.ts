import 'server-only';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {SignupEmailNotAttemptedError} from './academy-signup-worker-admission.ts';

export const TRIP390_ACK_VERSION='JLFA-TRIP390-ACK-ADMISSION-v2' as const;
export const TRIP390_ACK_FORM='JLFA-TRIP390-INTEREST-v3' as const;
export const TRIP390_ACK_NOTICE='JLFA-TRIP390-INTEREST-NOTICE-20261104-07-v1' as const;
export const TRIP390_ACK_COPY='JLFA-TRIP390-TRANSACTIONAL-20261104-02-v1' as const;
export const TRIP390_ACK_PURPOSE='trip390_reservation_acknowledgment' as const;
export const TRIP390_ACK_SENDER='office@bneineviimacademy.org' as const;
export const trip390AckSourceFiles=Object.freeze({
 admission:'src/features/group-application/academy-trip390-ack-admission.ts',
 formatter:'src/features/group-application/academy-trip390-email.ts',
 catalog:'src/features/group-application/academy-trip390-email-copy.json',
 contract:'src/features/group-application/academy-trip390-contract.ts',
 notice:'src/features/group-application/academy-trip390-reservation-notice.ts',conduct:'src/features/group-application/academy-trip390-student-conduct.ts',
 publicEn:'src/features/group-application/academy-trip390-en.json',publicHe:'src/features/group-application/academy-trip390-he.json',sharedContract:'src/features/group-application/contract.ts',
 outbox:'src/features/group-application/inquiry-email.ts',recordDecoder:'src/features/group-application/group-application-record.ts',
 gmail:'src/providers/email/gmail.ts',transport:'src/providers/email/transport.ts',
 worker:'scripts/inquiry-email-worker.ts',supervisor:'scripts/signup-worker-supervisor.ts',start:'scripts/start.mjs',
});
const sha=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid(),stamp=z.string().datetime({offset:true});
const hashes=z.object({admission:sha,formatter:sha,catalog:sha,contract:sha,notice:sha,conduct:sha,publicEn:sha,publicHe:sha,sharedContract:sha,outbox:sha,recordDecoder:sha,gmail:sha,transport:sha,worker:sha,supervisor:sha,start:sha}).strict();
const request=z.object({reference:uuid,outboxId:uuid,operationId:uuid,recipientSha256:sha,messageLanguage:z.enum(['en','he']),childIds:z.array(uuid).min(1).max(10),contentSha256:sha}).strict();
const schema=z.object({
 version:z.literal(TRIP390_ACK_VERSION),approvalReceiptSha256:sha,sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),
 workspaceId:uuid,projectId:uuid,environmentId:uuid,serviceId:uuid,
 origin:z.enum(['https://life-skills.bneineviimacademy.org','https://bneineviimacademy.org']),
 sender:z.literal(TRIP390_ACK_SENDER),replyTo:z.literal(TRIP390_ACK_SENDER),
 requestVersion:z.literal(TRIP390_ACK_FORM),noticeVersion:z.literal(TRIP390_ACK_NOTICE),
 payloadVersion:z.literal(2),payloadKind:z.literal(TRIP390_ACK_PURPOSE),templateVersion:z.literal(TRIP390_ACK_COPY),sourceHashes:hashes,
 notBefore:stamp,admittedAt:stamp,expiresAt:stamp.nullable(),
 population:z.discriminatedUnion('mode',[
  z.object({mode:z.literal('controlled_test'),requests:z.array(request).min(1).max(2)}).strict(),
  z.object({mode:z.literal('future_requests')}).strict(),
 ]),
}).strict();
export type Trip390AckAdmission=Readonly<z.infer<typeof schema>>;
export type Trip390AckContext={enabled:boolean;queueEnabled:boolean;genericSendOff:boolean;founderSendOff:boolean;authGmail:boolean;sourceCommit:string;releaseCommit:string;workspaceId:string;projectId:string;environmentId:string;serviceId:string;origin:string;sourceHashes:z.infer<typeof hashes>};
const issued=new WeakSet<object>();
export const trip390AckDigest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
export function createTrip390AckAdmission(input:unknown,c:Trip390AckContext,now:Date):Trip390AckAdmission|null{
 const parsed=schema.safeParse(input);if(!parsed.success||!c.enabled||!c.queueEnabled||!c.genericSendOff||!c.founderSendOff||!c.authGmail||!Number.isFinite(now.valueOf()))return null;
 const p=parsed.data;
 if(p.sourceCommit!==c.sourceCommit||p.sourceCommit!==c.releaseCommit||(['workspaceId','projectId','environmentId','serviceId','origin'] as const).some(k=>p[k]!==c[k])||(Object.keys(trip390AckSourceFiles) as (keyof typeof trip390AckSourceFiles)[]).some(k=>p.sourceHashes[k]!==c.sourceHashes[k]))return null;
 const start=Date.parse(p.notBefore),admitted=Date.parse(p.admittedAt),current=now.valueOf();
 if(start>admitted||admitted>current)return null;
 // Ongoing owner-authorized purpose is explicitly different from finite tests.
 // No expiry renewal: new policy/source/notice/copy requires separate admission.
 if(p.population.mode==='future_requests'&&p.expiresAt!==null)return null;
 if(p.population.mode==='controlled_test'){
  if(p.expiresAt===null)return null;const end=Date.parse(p.expiresAt);
  if(end<=current||end<=admitted||end-admitted>2*3600000)return null;
 }
 if(p.population.mode==='controlled_test'){
  if(new Set(p.population.requests.map(r=>r.reference)).size!==p.population.requests.length||new Set(p.population.requests.map(r=>r.outboxId)).size!==p.population.requests.length||new Set(p.population.requests.map(r=>r.operationId)).size!==p.population.requests.length)return null;
  for(const r of p.population.requests){if(new Set(r.childIds).size!==r.childIds.length)return null;Object.freeze(r.childIds);Object.freeze(r);}Object.freeze(p.population.requests);
 }
 Object.freeze(p.sourceHashes);Object.freeze(p.population);Object.freeze(p);issued.add(p);return p;
}
export function assertTrip390AckAdmission(p:Trip390AckAdmission,workspace:string,now:Date){
 if(!issued.has(p)||workspace!==p.workspaceId||!Number.isFinite(now.valueOf())||now.valueOf()<Date.parse(p.admittedAt)||(p.expiresAt!==null&&now.valueOf()>=Date.parse(p.expiresAt)))throw new SignupEmailNotAttemptedError();
}
export type Trip390AckFacts={reference:string;outboxId:string;operationIds:readonly string[];savedAt:string;queuedAt:string;version:string;noticeVersion:string;privacy:boolean;conduct:boolean;recipient:string;messageLanguage:'en'|'he';childIds:readonly string[];contentSha256:string};
export function trip390AckRequestAllowed(p:Trip390AckAdmission,f:Trip390AckFacts,now:Date){
 try{assertTrip390AckAdmission(p,p.workspaceId,now);}catch{return false;}
 const saved=Date.parse(f.savedAt),queued=Date.parse(f.queuedAt);
 if(f.version!==p.requestVersion||f.noticeVersion!==p.noticeVersion||f.privacy!==true||f.conduct!==true||!Number.isFinite(saved)||!Number.isFinite(queued)||saved<Date.parse(p.notBefore)||saved>now.valueOf()||queued<saved||queued>now.valueOf()||!f.operationIds.length||!f.childIds.length||new Set(f.childIds).size!==f.childIds.length)return false;
 if(p.population.mode==='future_requests')return true;
 const r=p.population.requests.find(r=>r.reference===f.reference&&r.outboxId===f.outboxId);
 return !!r&&f.operationIds.includes(r.operationId)&&r.recipientSha256===trip390AckDigest(f.recipient)&&r.messageLanguage===f.messageLanguage&&r.contentSha256===f.contentSha256&&r.childIds.length===f.childIds.length&&r.childIds.every(id=>f.childIds.includes(id));
}
/** Durable intent capture has its own gate; generic queues are not enabled. */
export function trip390AckQueueEnabled(env:Readonly<Record<string,string|undefined>>){return env.LS_ACADEMY_TRIP390_ACK_QUEUE_ENABLED==='true';}
/** Only source reads; no DB/provider/runtime import. Git-LF normalization is
 * explicit so the same reviewed bytes are admitted on Windows and Linux. */
export function loadTrip390AckAdmission(env:Readonly<Record<string,string|undefined>>,now:Date):Trip390AckAdmission|null{
 if(env.LS_ACADEMY_TRIP390_ACK_ENABLED!=='true'||!env.LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON)return null;
 try{
  const sourceHashes=Object.fromEntries(Object.entries(trip390AckSourceFiles).map(([key,file])=>[key,trip390AckDigest(readFileSync(resolve(process.cwd(),file),'utf8').replace(/\r\n/g,'\n'))])) as z.infer<typeof hashes>;
  return createTrip390AckAdmission(JSON.parse(env.LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON),{enabled:true,queueEnabled:trip390AckQueueEnabled(env),genericSendOff:env.LS_INQUIRY_EMAIL_SEND_ENABLED==='false',founderSendOff:env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED!=='true'&&env.LS_ACADEMY_SIGNUP_WORKER_ENABLED!=='true'&&env.LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED!=='true',authGmail:env.LS_AUTH_EMAIL_ENABLED==='true'&&env.LS_AUTH_EMAIL_PROVIDER==='gmail'&&env.LS_AUTH_EMAIL_FROM===TRIP390_ACK_SENDER,sourceCommit:env.RAILWAY_GIT_COMMIT_SHA??'',releaseCommit:env.LIFE_SKILLS_RELEASE_COMMIT??'',workspaceId:env.LS_IDENTITY_WORKSPACE_ID??'',projectId:env.RAILWAY_PROJECT_ID??'',environmentId:env.RAILWAY_ENVIRONMENT_ID??'',serviceId:env.RAILWAY_SERVICE_ID??'',origin:env.LS_APP_ORIGIN??'',sourceHashes},now);
 }catch{return null;}
}
