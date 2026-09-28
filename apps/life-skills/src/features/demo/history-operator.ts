import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {accountByEmail} from '../identity/data.ts';
import {blindEmail} from '../identity/crypto.ts';
import type {identityRuntime} from '../identity/runtime.ts';
import type {demoOperatorPlan} from './operator-plan.ts';
import type {AccountId,AudienceId,CaseId} from '../identity/types.ts';
import {demoAccountBatch} from './provenance.ts';
import {demoOperatorContext} from './operator-context.ts';
import {demoHistoryPlan} from './history-plan.ts';
import {CalendarStore} from '../calendar/store.ts';
import {CalendarService} from '../calendar/service.ts';
type Runtime=Pick<Awaited<ReturnType<typeof identityRuntime>>,'config'|'store'|'clock'>;
/** Private explicit operator only; keep authentication and scores out of setup.
 * Ordinary production practitioner UI will supply and save observations. */
export async function prepareDemoHistory(runtime:Runtime,selection:ReturnType<typeof demoOperatorPlan>,recipe:unknown,permission:boolean){
 if(permission!==true)throw new AppError('FORBIDDEN');
 const {batch,ownerEmail,addresses}=selection,plan=demoHistoryPlan(recipe,batch);
 const selected=await runtime.store.transaction(async tx=>{
  const owner=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(ownerEmail,runtime.config.lookupKey));
  if(!owner||owner.role!=='practitioner'||owner.state!=='active'||!owner.emailVerifiedAt||await demoAccountBatch(tx,runtime.config.workspaceId,owner.id))throw new AppError('FORBIDDEN');
  const accounts:Record<string,AccountId>={};
  for(const [role,email] of Object.entries(addresses)){const a=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(email,runtime.config.lookupKey));
   if(!a||a.role!==(role==='adult'?'adult_client':role)||a.state!=='active'||!a.emailVerifiedAt||await demoAccountBatch(tx,runtime.config.workspaceId,a.id)!==batch)throw new AppError('CONFLICT');accounts[role]=a.id;}
  const cases=await tx.query<{caseId:CaseId;personId:string}>(`SELECT c.id AS "caseId",cl.person_id AS "personId" FROM ls_demo.cases d
   JOIN ls_cases.cases c ON c.workspace_id=d.workspace_id AND c.id=d.case_id
   JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
   JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
   WHERE d.workspace_id=$1 AND d.batch_id=$2 AND d.source_key='owner-minor-a' AND c.practitioner_account_id=$3 AND c.state='active' AND p.kind='minor'`,[runtime.config.workspaceId,batch,owner.id]);
  if(cases.length!==1)throw new AppError('CONFLICT');const item=cases[0]!;
  await demoOperatorContext(tx,runtime.config.workspaceId,owner.id,item.caseId,batch,permission);
  if((await tx.query('SELECT account_id FROM ls_identity.account_subjects WHERE workspace_id=$1 AND person_id=$2 AND account_id=$3',[runtime.config.workspaceId,item.personId,accounts.child])).length!==1)throw new AppError('CONFLICT');
  const guardians=await tx.query<{id:AccountId}>('SELECT account_id AS id FROM ls_cases.case_guardians WHERE workspace_id=$1 AND case_id=$2 AND revoked_at IS NULL',[runtime.config.workspaceId,item.caseId]);
  if(guardians.length!==1||guardians[0]?.id!==accounts.parent)throw new AppError('CONFLICT');
  const audiences=await tx.query<{id:AudienceId}>("SELECT id FROM ls_cases.audiences WHERE workspace_id=$1 AND case_id=$2 AND published AND visibility='family_full'",[runtime.config.workspaceId,item.caseId]);
  if(audiences.length!==1)throw new AppError('CONFLICT');const audience=audiences[0]!;
  const members=await tx.query<{id:AccountId}>('SELECT account_id AS id FROM ls_cases.audience_accounts WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3 AND revoked_at IS NULL',[runtime.config.workspaceId,item.caseId,audience.id]);
  if(JSON.stringify(members.map(m=>m.id).sort())!==JSON.stringify([accounts.parent!,accounts.child!].sort()))throw new AppError('CONFLICT');
  const time=await tx.query<{now:Date}>('SELECT clock_timestamp() AS now');if(time.length!==1)throw new AppError('UNAVAILABLE');
  for(const sample of plan.items){const start=Date.parse(sample.startsAt),end=start+60*60_000;
   if(end>time[0]!.now.valueOf()||start<time[0]!.now.valueOf()-31*86_400_000)throw new AppError('INVALID_REQUEST');
   if((await tx.query(`SELECT a.id FROM ls_calendar.appointments a WHERE a.workspace_id=$1 AND a.practitioner_id=$2 AND a.status='scheduled'
    AND a.starts_at-a.buffer_before*interval '1 minute'<$4 AND a.ends_at+a.buffer_after*interval '1 minute'>$3
    AND NOT EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=a.workspace_id AND d.case_id=a.case_id) LIMIT 1`,[runtime.config.workspaceId,owner.id,sample.startsAt,new Date(end).toISOString()])).length)throw new AppError('CONFLICT');}
  return {ownerId:owner.id,caseId:item.caseId,audienceId:audience.id};
 });
 const calendar=new CalendarService(new CalendarStore(runtime.store,runtime.config.keyring,runtime.clock));
 for(const item of plan.items)await calendar.createDemoHistoryAsOperator(runtime.config.workspaceId,selected.ownerId,batch,item.commandKey,
  {caseId:selected.caseId,audienceId:selected.audienceId,kind:'individual',startsAt:item.startsAt,parentForId:null,parentIds:[],bufferBefore:0,bufferAfter:0,location:item.location,checkinExceptionReason:null},permission);
 return {batch,createdOrReused:plan.items.length,accountChanges:0,providerEffects:0,paymentEffects:0,observationsWritten:0};
}
