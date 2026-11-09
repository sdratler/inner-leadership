import 'server-only';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { INQUIRY_EMAIL_CONTROL_PURPOSE } from './academy-inquiry-email-verification.ts';

export const EMAIL_CONTROL_ADMISSION = 'JLFA-INQUIRY-EMAIL-CONTROL-ADMISSION-v1' as const;
export const EMAIL_CONTROL_SENDER = 'office@bneineviimacademy.org' as const;
const origin = 'https://bneineviimacademy.org';
const modulePath = 'src/features/group-application/';
export const inquiryEmailControlSourceFiles = Object.freeze({
 admission:modulePath+'academy-inquiry-email-control-admission.ts',outbox:modulePath+'academy-inquiry-email-control-outbox.ts',
 verification:modulePath+'academy-inquiry-email-verification.ts',formatter:modulePath+'academy-inquiry-email-control-email.ts',
 catalog:modulePath+'academy-inquiry-email-control-copy.json',copyHelper:modulePath+'academy-inquiry-email-control-copy.ts',originalFormatter:modulePath+'academy650-r2-ack.ts',
 originalCatalog:modulePath+'academy650-r2-ack-copy.json',storedRequest:modulePath+'group-application-record.ts',
 contract:modulePath+'contract.ts',currentRequest:modulePath+'academy-trip390-contract.ts',
 gmail:'src/providers/email/gmail.ts',transport:'src/providers/email/transport.ts',crypto:'src/features/identity/crypto.ts',
 runtime:modulePath+'academy-inquiry-email-control-runtime.ts',publicSignup:'src/app/api/public/group-applications/route.ts',
 publicConfirmation:'src/app/api/public/academy-founder/route.ts',ownerRoute:'src/app/api/private/group-applications/route.ts',
 signupHttp:modulePath+'http.ts',confirmationHttp:modulePath+'academy-founder-http.ts',proxy:'src/proxy.ts',
 worker:'scripts/inquiry-email-worker.ts',start:'scripts/start.mjs',
});
export const emailControlDigest = (value:string) => createHash('sha256').update(value,'utf8').digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const instant = z.iso.datetime({offset:true});
const targetKeys = ['workspaceId','projectId','environmentId','serviceId','origin'] as const;
const policySchema = z.object({
 version:z.literal(EMAIL_CONTROL_ADMISSION),purpose:z.literal(INQUIRY_EMAIL_CONTROL_PURPOSE),
 sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),approvalReceiptSha256:sha,sourceHashes:z.record(z.string(),sha),
 workspaceId:uuid,projectId:uuid,environmentId:uuid,serviceId:uuid,origin:z.literal(origin),sender:z.literal(EMAIL_CONTROL_SENDER),
 securityLifetimeMs:z.number().int().min(1000).max(86400000),notBefore:instant,admittedAt:instant,expiresAt:instant.nullable(),
 population:z.discriminatedUnion('mode',[
  z.object({mode:z.literal('future_requests')}).strict(),
  z.object({mode:z.literal('controlled_test'),requests:z.array(z.object({reference:uuid,recipientSha256:sha}).strict()).min(1).max(2)}).strict(),
 ]),
}).strict();
export type InquiryEmailControlAdmission = Readonly<z.infer<typeof policySchema>>;
type Env = Readonly<Record<string,string|undefined>>;
export type EmailControlContext = {
 enabled:boolean;queueEnabled:boolean;genericOff:boolean;founderOff:boolean;freeOff:boolean;oldAckOff:boolean;officeGmail:boolean;
 backendOrigin:string;
 securityLifetimeMs:number|null;
 sourceCommit:string;releaseCommit:string;workspaceId:string;projectId:string;environmentId:string;serviceId:string;origin:string;sourceHashes:Readonly<Record<string,string>>;
};
const issued = new WeakSet<InquiryEmailControlAdmission>();

export function createInquiryEmailControlAdmission(input:unknown,context:EmailControlContext,now:Date):InquiryEmailControlAdmission|null {
 const parsed = policySchema.safeParse(input);
 if (!parsed.success || !context.enabled || !context.queueEnabled || !context.genericOff || !context.founderOff || !context.freeOff || !context.oldAckOff ||
     !context.officeGmail || context.backendOrigin !== 'https://life-skills.bneineviimacademy.org') return null;
 const p = parsed.data;
 if (p.securityLifetimeMs !== context.securityLifetimeMs) return null;
 if (targetKeys.some(key => p[key] !== context[key]) || p.sourceCommit !== context.sourceCommit || p.sourceCommit !== context.releaseCommit) return null;
 const keys = Object.keys(inquiryEmailControlSourceFiles);
 if (Object.keys(p.sourceHashes).length !== keys.length || keys.some(key => !Object.hasOwn(p.sourceHashes,key) || p.sourceHashes[key] !== context.sourceHashes[key])) return null;
 const start = Date.parse(p.notBefore), admitted = Date.parse(p.admittedAt), at = now.getTime();
 if (!Number.isFinite(at) || start > admitted || admitted > at) return null;
 if (p.population.mode === 'controlled_test') {
  if (!p.expiresAt || Date.parse(p.expiresAt) <= at || Date.parse(p.expiresAt)-admitted > 2*3600000 ||
      new Set(p.population.requests.map(row => row.reference)).size !== p.population.requests.length) return null;
  for (const row of p.population.requests) Object.freeze(row);
  Object.freeze(p.population.requests);
 } else if (p.expiresAt !== null) return null;
 Object.freeze(p.sourceHashes); Object.freeze(p.population); Object.freeze(p); issued.add(p);
 return p;
}

export function inquiryEmailControlAllows(p:InquiryEmailControlAdmission,workspace:string,now:Date):boolean {
 const at = now.getTime();
 return issued.has(p) && p.workspaceId === workspace && Number.isFinite(at) && at >= Date.parse(p.admittedAt) && (p.expiresAt === null || at < Date.parse(p.expiresAt));
}
export function inquiryEmailControlRequestAllowed(p:InquiryEmailControlAdmission,workspace:string,f:{reference:string;recipient:string;savedAt:Date},now:Date):boolean {
 const saved = f.savedAt.getTime();
 if (!inquiryEmailControlAllows(p,workspace,now) || !Number.isFinite(saved) || saved < Date.parse(p.notBefore) || saved > now.getTime()) return false;
 return p.population.mode === 'future_requests' || p.population.requests.some(r => r.reference === f.reference && r.recipientSha256 === emailControlDigest(f.recipient));
}

/** Required security configuration for the verification token. */
export function inquiryEmailControlSecurityLifetimeMs(env:Env):number|null {
 const raw = env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_SECURITY_LIFETIME_MS ?? '';
 if (!/^[1-9]\d{3,7}$/.test(raw)) return null;
 const value = Number(raw);
 return value <= 86400000 ? value : null;
}

/** The current files, target and purpose-specific settings determine admission. */
export function loadInquiryEmailControlAdmission(env:Env,now:Date):InquiryEmailControlAdmission|null {
 if (env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED !== 'true' || !env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ADMISSION_JSON) return null;
 try {
  const hashes = Object.fromEntries(Object.entries(inquiryEmailControlSourceFiles).map(([key,file]) =>
   [key,emailControlDigest(readFileSync(resolve(process.cwd(),file),'utf8').replace(/\r\n/g,'\n'))]));
  return createInquiryEmailControlAdmission(JSON.parse(env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ADMISSION_JSON),{
   enabled:true,queueEnabled:env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_QUEUE_ENABLED === 'true',
   securityLifetimeMs:inquiryEmailControlSecurityLifetimeMs(env),
   genericOff:env.LS_INQUIRY_EMAIL_SEND_ENABLED === 'false',freeOff:env.LS_ACADEMY_FREE_REGISTRATION_ENABLED === 'false',
   oldAckOff:env.LS_ACADEMY_TRIP390_ACK_ENABLED !== 'true',backendOrigin:env.LS_APP_ORIGIN ?? '',
   founderOff:env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED !== 'true' && env.LS_ACADEMY_SIGNUP_WORKER_ENABLED !== 'true' && env.LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED !== 'true',
   officeGmail:env.LS_AUTH_EMAIL_ENABLED === 'true' && env.LS_AUTH_EMAIL_PROVIDER === 'gmail' && env.LS_AUTH_EMAIL_FROM === EMAIL_CONTROL_SENDER,
   sourceCommit:env.RAILWAY_GIT_COMMIT_SHA ?? '',releaseCommit:env.LIFE_SKILLS_RELEASE_COMMIT ?? '',
   workspaceId:env.LS_IDENTITY_WORKSPACE_ID ?? '',projectId:env.RAILWAY_PROJECT_ID ?? '',environmentId:env.RAILWAY_ENVIRONMENT_ID ?? '',
   serviceId:env.RAILWAY_SERVICE_ID ?? '',origin:env.LS_GROUP_APPLICATION_PUBLIC_ORIGIN ?? '',sourceHashes:hashes,
  },now);
 } catch { return null; }
}
