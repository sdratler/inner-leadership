import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {BNA_REPLY_MONITOR_TARGET,readBnaReplyMonitorPolicy,bnaReplyMonitorBinding,type BnaReplyMonitorPolicy} from '../../src/features/bna-communications/reply-monitor-admission.ts';
import {assertBnaReplyMonitorTarget} from '../../src/features/bna-communications/reply-monitor-runtime.ts';
const now=new Date('2026-10-30T12:00:00Z');
function fixture(){
 const p:BnaReplyMonitorPolicy={version:1,mode:'controlled_test',releaseCommit:'a'.repeat(40),deploymentId:randomUUID(),target:{...BNA_REPLY_MONITOR_TARGET},primaryMailbox:'synthetic-owner@example.invalid',
  activatedAt:'2026-10-30T11:00:00Z',monitorFrom:'2026-10-30T10:00:00Z',sourceSince:'2026-10-30T09:00:00Z',inquiryIds:[randomUUID()],expiresAt:'2026-10-30T14:00:00Z'};
 const env:Record<string,string|undefined>={LS_BNA_REPLY_MONITOR_ENABLED:'true',LS_BNA_REPLY_MONITOR_ADMISSION_JSON:JSON.stringify(p),LS_BNA_MAILBOX_REPLIES_ENABLED:'true',LS_BNA_PREFERENCES_ENABLED:'true',LS_BNA_EMAIL_QUEUE_ENABLED:'true',
  LS_BNA_EMAIL_QUEUE_SINCE:p.sourceSince,LS_IDENTITY_WORKSPACE_ID:p.target.workspaceId,LS_BNA_OWNER_ACCOUNT_ID:p.target.ownerId,RAILWAY_PROJECT_ID:p.target.projectId,RAILWAY_ENVIRONMENT_ID:p.target.environmentId,
  RAILWAY_SERVICE_ID:p.target.serviceId,RAILWAY_DEPLOYMENT_ID:p.deploymentId,RAILWAY_GIT_COMMIT_SHA:p.releaseCommit,LS_APP_ORIGIN:'https://life-skills.bneineviimacademy.org',
  LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:'office@bneineviimacademy.org',LS_DATABASE_TLS:'verify-full',LS_DATABASE_CA:'SYNTHETIC_CA',LS_DATABASE_URL:'postgresql://synthetic:synthetic@postgres.railway.internal:5432/railway'};
 return {p,env};
}
it('does nothing by default and never infers the primary inbox from Office From or requests broader scopes',()=>{
 expect(readBnaReplyMonitorPolicy({},now)).toBeNull();const f=fixture();expect(readBnaReplyMonitorPolicy(f.env,now)).toEqual(f.p);
 const {primaryMailbox,...missing}=f.p;void primaryMailbox;f.env.LS_BNA_REPLY_MONITOR_ADMISSION_JSON=JSON.stringify(missing);expect(()=>readBnaReplyMonitorPolicy(f.env,now)).toThrow('UNAVAILABLE');
});
it('fails closed on feature, origin, immutable deployment, owner, provider and strict TLS drift',()=>{
 for(const [name,value] of Object.entries({LS_BNA_MAILBOX_REPLIES_ENABLED:'false',LS_BNA_PREFERENCES_ENABLED:'false',LS_BNA_EMAIL_QUEUE_ENABLED:'false',LS_IDENTITY_WORKSPACE_ID:randomUUID(),LS_BNA_OWNER_ACCOUNT_ID:randomUUID(),
  RAILWAY_PROJECT_ID:randomUUID(),RAILWAY_ENVIRONMENT_ID:randomUUID(),RAILWAY_SERVICE_ID:randomUUID(),RAILWAY_DEPLOYMENT_ID:randomUUID(),RAILWAY_GIT_COMMIT_SHA:'b'.repeat(40),LS_APP_ORIGIN:'https://other.invalid',
  LS_AUTH_EMAIL_ENABLED:'false',LS_AUTH_EMAIL_PROVIDER:'console',LS_AUTH_EMAIL_FROM:'other@example.invalid',LS_DATABASE_TLS:'disable',LS_DATABASE_CA:'',NODE_TLS_REJECT_UNAUTHORIZED:'0',LS_DATABASE_URL:'postgresql://synthetic:synthetic@localhost:5432/railway'})){
  const f=fixture();f.env[name]=value;expect(()=>readBnaReplyMonitorPolicy(f.env,now),name).toThrow('UNAVAILABLE');
 }
});
it('bounds the controlled population, time and source cutoff, rejects target overrides, and binds policy changes to coverage',()=>{
 for(const change of [{expiresAt:'2026-10-30T11:59:00Z'},{expiresAt:'2026-10-31T00:00:00Z'},{activatedAt:'2026-10-31T00:00:00Z'},
  {monitorFrom:'2026-10-30T11:30:00Z'},{sourceSince:'2026-10-30T08:00:00Z'},{inquiryIds:[]},{inquiryIds:Array.from({length:5},()=>randomUUID())},{primaryMailbox:'bad'},
  {target:{...BNA_REPLY_MONITOR_TARGET,databaseSystemId:'1234567890123456789'}}]){const f=fixture();f.env.LS_BNA_REPLY_MONITOR_ADMISSION_JSON=JSON.stringify({...f.p,...change});expect(()=>readBnaReplyMonitorPolicy(f.env,now)).toThrow('UNAVAILABLE');}
 const f=fixture(),a=bnaReplyMonitorBinding(f.p),b=bnaReplyMonitorBinding({...f.p,primaryMailbox:'different@example.invalid'});expect(a.policyDigest).toMatch(/^[a-f0-9]{64}$/);expect(a.policyDigest).not.toBe(b.policyDigest);
});
it('requires explicit completed controlled-cycle evidence for an ongoing policy',()=>{
 const f=fixture(),{expiresAt,...base}=f.p;void expiresAt;
 const ongoing={...base,mode:'ongoing',inquiryIds:null};f.env.LS_BNA_REPLY_MONITOR_ADMISSION_JSON=JSON.stringify(ongoing);expect(()=>readBnaReplyMonitorPolicy(f.env,now)).toThrow('UNAVAILABLE');
 f.env.LS_BNA_REPLY_MONITOR_ADMISSION_JSON=JSON.stringify({...ongoing,controlledProof:{cycleId:randomUUID(),bindingDigest:'b'.repeat(64),readbackSha256:'c'.repeat(64)}});expect(readBnaReplyMonitorPolicy(f.env,now)?.mode).toBe('ongoing');
});
it('checks native database identity, SSL and database name before admitting any provider read',async()=>{
 const f=fixture();for(const target of [{systemId:'wrong',ssl:true,databaseName:'railway'},{systemId:f.p.target.databaseSystemId,ssl:false,databaseName:'railway'},{systemId:f.p.target.databaseSystemId,ssl:true,databaseName:'other'}]){
  const called=vi.fn(),query=async<T extends object>(sql:string)=>{called(sql);return [target] as unknown as T[];};
  await expect(assertBnaReplyMonitorTarget({transaction:fn=>fn({query})},f.p)).rejects.toThrow('UNAVAILABLE');expect(called).toHaveBeenCalledTimes(2);
 }
});
