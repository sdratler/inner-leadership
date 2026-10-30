import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {bnaMailboxRepliesSchemaPlan,readBnaMailboxRepliesSchemaStage} from '../../db/bna-mailbox-replies-schema-release.ts';
import {one,type IdentityStore} from '../identity/store.ts';
import type {IdentityClock} from '../identity/types.ts';
import type {Keyring} from '../identity/crypto.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {parseGmailAuthConfig} from '../../providers/email/gmail.ts';
import {BnaAcknowledgmentStore} from './acknowledgment-store.ts';
import {BnaInquiryStore} from '../bna-inquiry/store.ts';
import {BnaPreferenceStore} from './preferences-store.ts';
import {BnaOptionalCalendarStore} from './optional-calendar-store.ts';
import {BnaReplyStore} from './reply-store.ts';
import {BnaReplySourceCatalog} from './reply-source-catalog.ts';
import {BnaReplyMonitorStore} from './reply-monitor-store.ts';
import {BnaGmailReplyReader} from './gmail-reply-reader.ts';
import {readBnaReplyMonitorPolicy,bnaReplyMonitorBinding,type BnaReplyMonitorPolicy} from './reply-monitor-admission.ts';
export async function assertBnaReplyMonitorTarget(db:IdentityStore,p:BnaReplyMonitorPolicy){
 await db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');
  const target=await one<{systemId:string;ssl:boolean;databaseName:string}>(tx,`SELECT system_identifier::text AS "systemId",current_database() AS "databaseName",(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl FROM pg_control_system()`);
  if(target?.systemId!==p.target.databaseSystemId||target.ssl!==true||target.databaseName!=='railway'||!await one(tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[p.target.workspaceId,p.target.ownerId]))throw new AppError('UNAVAILABLE');
  const query={query:async<T extends object>(sql:string,values?:readonly unknown[])=>({rows:await tx.query<T>(sql,values)})};
  if(await readBnaMailboxRepliesSchemaStage(query)!==1)throw new AppError('UNAVAILABLE');
  const history=await tx.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name');
  if(history.length!==70||bnaMailboxRepliesSchemaPlan(history.map(h=>({...h,sql:''})),history,1).pending.length)throw new AppError('UNAVAILABLE');
 });
}
/** The hosted worker constructs the real metadata reader here. Web owner
 * refreshes use the review factory and never construct or invoke this reader. */
export function bnaReplyMonitorRuntime(d:{db:IdentityStore;workspace:WorkspaceId;owner:string;ring:Keyring;key:string;clock:IdentityClock;env:Record<string,string|undefined>}){
 const current=()=>{const p=readBnaReplyMonitorPolicy(d.env,d.clock.now());if(!p||p.target.workspaceId!==d.workspace||p.target.ownerId!==d.owner)throw new AppError('UNAVAILABLE');return p;};
 const p=current(),binding=bnaReplyMonitorBinding(p),inquiries=new BnaInquiryStore(d.db,d.workspace,d.ring,d.key,d.owner,d.clock);
 const preferences=new BnaPreferenceStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries);
 const sources={service:new BnaAcknowledgmentStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock),optional:new BnaOptionalCalendarStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries,preferences)};
 const replies=new BnaReplyStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,sources,()=>{const a=bnaReplyMonitorBinding(current());return {primaryMailbox:a.primaryMailbox,monitorFrom:a.monitorFrom};});
 const monitor=new BnaReplyMonitorStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,new BnaReplySourceCatalog(d.workspace,d.owner,d.key,d.clock),replies,()=>bnaReplyMonitorBinding(current()));
 const reader=new BnaGmailReplyReader(parseGmailAuthConfig(d.env),binding.primaryMailbox,binding.monitorFrom,d.clock);
 return {async runBatch(){const policy=current();if(bnaReplyMonitorBinding(policy).policyDigest!==binding.policyDigest)throw new AppError('UNAVAILABLE');
  await assertBnaReplyMonitorTarget(d.db,policy);if(policy.mode==='ongoing')await monitor.verifyControlledCycle(policy.controlledProof);
  const result=await monitor.runBatch(reader);if(result.state==='failed'||result.state==='superseded')throw new AppError('UNAVAILABLE');return result;
 }};
}
