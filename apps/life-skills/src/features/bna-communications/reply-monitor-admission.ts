import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {BnaReplyMonitorAdmission} from './reply-monitor-store.ts';
import {BNA_EMAIL_SENDER} from './delivery-policy.ts';
export const BNA_REPLY_MONITOR_TARGET={projectId:'3b756632-1f66-4f75-a016-eabc37aa0d67',environmentId:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',
 serviceId:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',databaseSystemId:'7682781321794240577',
 workspaceId:'1553e959-b299-40e4-b82e-8529597b69ec',ownerId:'db705ddc-bab7-4fdf-9ad8-50aaf270f6a7'} as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.uuid(),instant=z.iso.datetime();
const common={version:z.literal(1),releaseCommit:z.string().regex(/^[a-f0-9]{40}$/),deploymentId:uuid,
 target:z.strictObject({projectId:uuid,environmentId:uuid,serviceId:uuid,databaseSystemId:z.string().regex(/^\d{10,25}$/),workspaceId:uuid,ownerId:uuid}),
 primaryMailbox:z.email().max(254).refine(s=>/^[\x21-\x7e]+$/.test(s)).transform(s=>s.toLowerCase()),
 activatedAt:instant,monitorFrom:instant,sourceSince:instant};
export const bnaReplyMonitorPolicy=z.discriminatedUnion('mode',[
 z.strictObject({...common,mode:z.literal('controlled_test'),inquiryIds:z.array(uuid).min(1).max(4),expiresAt:instant}),
 z.strictObject({...common,mode:z.literal('ongoing'),inquiryIds:z.null(),controlledProof:z.strictObject({cycleId:uuid,bindingDigest:hash,readbackSha256:hash})}),
]);
export type BnaReplyMonitorPolicy=z.infer<typeof bnaReplyMonitorPolicy>;
/** Protected server configuration only. No OAuth grant expansion, guessed
 * mailbox from a send alias, browser scope selection or fallback credential. */
export function readBnaReplyMonitorPolicy(env:Record<string,string|undefined>,now:Date):BnaReplyMonitorPolicy|null{
 if(env.LS_BNA_REPLY_MONITOR_ENABLED!=='true')return null;
 try{
  const p=bnaReplyMonitorPolicy.parse(JSON.parse(env.LS_BNA_REPLY_MONITOR_ADMISSION_JSON??'null'));
  if(Object.entries(BNA_REPLY_MONITOR_TARGET).some(([k,v])=>p.target[k as keyof typeof p.target]!==v)||
   env.LS_BNA_MAILBOX_REPLIES_ENABLED!=='true'||env.LS_BNA_PREFERENCES_ENABLED!=='true'||env.LS_BNA_EMAIL_QUEUE_ENABLED!=='true'||
   env.LS_IDENTITY_WORKSPACE_ID!==p.target.workspaceId||env.LS_BNA_OWNER_ACCOUNT_ID!==p.target.ownerId||
   env.RAILWAY_PROJECT_ID!==p.target.projectId||env.RAILWAY_ENVIRONMENT_ID!==p.target.environmentId||env.RAILWAY_SERVICE_ID!==p.target.serviceId||
   env.RAILWAY_DEPLOYMENT_ID!==p.deploymentId||env.RAILWAY_GIT_COMMIT_SHA!==p.releaseCommit||env.LS_APP_ORIGIN!=='https://life-skills.bneineviimacademy.org'||
   env.LS_AUTH_EMAIL_ENABLED!=='true'||env.LS_AUTH_EMAIL_PROVIDER!=='gmail'||env.LS_AUTH_EMAIL_FROM!==BNA_EMAIL_SENDER||
   env.LS_DATABASE_TLS!=='verify-full'||!env.LS_DATABASE_CA?.trim()||env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||
   !Number.isFinite(now.getTime())||Date.parse(p.activatedAt)>now.getTime()||Date.parse(p.monitorFrom)>Date.parse(p.activatedAt)||
   Date.parse(p.sourceSince)>Date.parse(p.monitorFrom)||!z.iso.datetime({offset:true}).safeParse(env.LS_BNA_EMAIL_QUEUE_SINCE).success||
   Date.parse(p.sourceSince)<Date.parse(env.LS_BNA_EMAIL_QUEUE_SINCE!))throw Error();
  const db=new URL(env.LS_DATABASE_URL??'');
  if(!['postgres:','postgresql:'].includes(db.protocol)||db.hostname!=='postgres.railway.internal'||db.port!=='5432'||db.pathname!=='/railway'||db.search||db.hash||!db.username||!db.password)throw Error();
  if(p.mode==='controlled_test'&&(new Set(p.inquiryIds).size!==p.inquiryIds.length||Date.parse(p.expiresAt)<=now.getTime()||
   Date.parse(p.expiresAt)-Date.parse(p.activatedAt)>14400000))throw Error();
  return p;
 }catch{throw new AppError('UNAVAILABLE');}
}
export function bnaReplyMonitorBinding(p:BnaReplyMonitorPolicy):BnaReplyMonitorAdmission{
 return {primaryMailbox:p.primaryMailbox,monitorFrom:p.monitorFrom,sourceSince:p.sourceSince,inquiryIds:p.inquiryIds,
  policyDigest:createHash('sha256').update(JSON.stringify(p)).digest('hex')};
}
