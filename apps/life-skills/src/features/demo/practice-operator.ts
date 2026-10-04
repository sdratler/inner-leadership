import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {accountByEmail} from '../identity/data.ts';
import {blindEmail} from '../identity/crypto.ts';
import type {identityRuntime} from '../identity/runtime.ts';
import type {demoOperatorPlan} from './operator-plan.ts';
import type {AccountId,AudienceId,CaseId} from '../identity/types.ts';
import {demoAccountBatch} from './provenance.ts';
import {demoOperatorContext} from './operator-context.ts';
import {demoPracticePlan} from './practice-plan.ts';
import {HomePracticeService} from '../home-practice/service.ts';
import type {ResponsibilityInput} from '../home-practice/responsibility-input.ts';
import {possibleInstants} from '../calendar/time.ts';
type Runtime=Pick<Awaited<ReturnType<typeof identityRuntime>>,'config'|'store'|'clock'>;

/** Reuse existing verified demo identities and cases. No credential access,
 * invitations, consent, role changes, notices, charges or booking operations. */
export async function prepareDemoPractice(runtime:Runtime,selection:ReturnType<typeof demoOperatorPlan>,recipe:unknown,occursOn:string,permission:boolean){
 if(permission!==true)throw new AppError('FORBIDDEN');
 const {batch,ownerEmail,addresses}=selection,plan=demoPracticePlan(recipe,batch,occursOn);
 const selected=await runtime.store.transaction(async tx=>{
  const owner=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(ownerEmail,runtime.config.lookupKey));
  if(!owner||owner.role!=='practitioner'||owner.state!=='active'||!owner.emailVerifiedAt||await demoAccountBatch(tx,runtime.config.workspaceId,owner.id))throw new AppError('FORBIDDEN');
  const accounts:Record<string,AccountId>={};
  for(const [role,email] of Object.entries(addresses)){
   const a=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(email,runtime.config.lookupKey));
   if(!a||a.role!==(role==='adult'?'adult_client':role)||a.state!=='active'||!a.emailVerifiedAt||await demoAccountBatch(tx,runtime.config.workspaceId,a.id)!==batch)throw new AppError('CONFLICT');
   accounts[role]=a.id;
  }
  const cases:Record<string,{caseId:CaseId;audienceId:AudienceId}>={};
  for(const source of ['owner-minor-a','owner-adult-a']){
   const rows=await tx.query<{caseId:CaseId;audienceId:AudienceId}>(`SELECT c.id AS "caseId",au.id AS "audienceId" FROM ls_demo.cases d
    JOIN ls_cases.cases c ON c.workspace_id=d.workspace_id AND c.id=d.case_id
    JOIN ls_cases.audiences au ON au.workspace_id=c.workspace_id AND au.case_id=c.id AND au.published AND au.visibility='family_full'
    WHERE d.workspace_id=$1 AND d.batch_id=$2 AND d.source_key=$3 AND c.state='active' AND c.practitioner_account_id=$4`,
    [runtime.config.workspaceId,batch,source,owner.id]);
   if(rows.length!==1)throw new AppError('CONFLICT');
   const expected=(source==='owner-minor-a'?[accounts.parent!,accounts.child!]:[accounts.adult!]).sort();
   const members=await tx.query<{id:AccountId}>('SELECT account_id AS id FROM ls_cases.audience_accounts WHERE workspace_id=$1 AND audience_id=$2 AND revoked_at IS NULL ORDER BY account_id',[runtime.config.workspaceId,rows[0]!.audienceId]);
   if(JSON.stringify(members.map(row=>row.id))!==JSON.stringify(expected))throw new AppError('CONFLICT');
   await demoOperatorContext(tx,runtime.config.workspaceId,owner.id,rows[0]!.caseId,batch,permission);
   cases[source]=rows[0]!;
  }
  // Validate the whole pending recipe before committing its first item. Existing
  // receipts still pass through the service's exact-body and access checks.
  const now=runtime.clock.now().getTime();
  for(const item of plan){
   const saved=await tx.query('SELECT 1 FROM ls_calendar.commands WHERE workspace_id=$1 AND account_id=$2 AND operation=$3 AND command_key=$4',
    [runtime.config.workspaceId,owner.id,'demo:practice',item.commandKey]);
   const instants=possibleInstants(item.occursOn+'T'+item.localTime);
   if(instants.length!==1||(!saved.length&&Date.parse(instants[0]!)<=now))throw new AppError('INVALID_REQUEST');
  }
  return {ownerId:owner.id,accounts,cases};
 });
 const service=new HomePracticeService(runtime.store,runtime.config,runtime.clock);
 for(const item of plan){
  const context=selected.cases[item.caseSource]!;
  const responsibility:ResponsibilityInput={participant:item.role==='parent'?'parent':'client',period:'evening',
   assigneeAccountIds:[selected.accounts[item.role]!],assistedByParentAccountIds:item.role==='child'?[selected.accounts.parent!]:[],
   reminderRecipients:[],completionMode:'any_assignee',weekdays:[0,1,2,3,4,5,6],localTime:item.localTime,timezone:'Asia/Jerusalem',timeOrigin:'practitioner',foldChoice:null};
  await service.prepareDemoAsOperator(runtime.config.workspaceId,selected.ownerId,batch,item.commandKey,
   {...context,demoAudienceAccountIds:item.role==='adult'?[selected.accounts.adult!]:[selected.accounts.parent!,selected.accounts.child!],templateKey:'DEMO',templateVersion:'owner-practice-v1',instructions:item.instructions,startsOn:item.startsOn,endsOn:item.endsOn,responsibility,
    occurrences:[{occursOn:item.occursOn,period:'evening'}]},permission);
 }
 return {batch,createdOrReused:plan.length,accountChanges:0,providerEffects:0,paymentEffects:0,completionReportsWritten:0};
}
