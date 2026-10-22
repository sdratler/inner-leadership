/** Owned disposable synthetic fixture. Existing paid-family setup and actual
 * native enrollment/publication commands; no provider or production access. */
import {randomUUID} from 'node:crypto';
import {admitNativeCi} from '../../database/native-ci-admission.ts';
import {refundFormsFixture} from './academy-refund-forms-fixture.ts';
import {handleFishingCalendar} from '../../../src/features/fishing/program-calendar-http.ts';
import {fishingCalendarSearch,type FishingCalendarSelection,type FishingCalendarPlan} from '../../../src/features/fishing/program-calendar-contract.ts';
import type {SafetyCommand} from '../../../src/features/fishing-stage/safety.ts';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
export async function safetyFormsFixture(origin:string){
 if(!await admitNativeCi(['program'])&&process.env.LS_ACADEMY_SAFETY_FORMS_BROWSER!=='SYNTHETIC_LOOPBACK_ONLY')throw Error('EXACT_SAFETY_FORMS_TARGET_REQUIRED');
 const f=await refundFormsFixture(origin,'ordinary_sundays');
 try{
  const families:Array<Omit<typeof f.families[number],'purchases'>&{purchases:Array<typeof f.families[number]['purchases'][number]&{enrollmentId:string}>}>=[];
  for(const family of f.families){const enrolled=[];for(const purchase of family.purchases){
   const fits=(await f.pool.query("SELECT id FROM ls_fishing_stage.fit_decisions WHERE workspace_id=$1 AND stage_id=$2 AND learner_id=$3 AND purpose='enrollment'",[f.workspaceId,f.ref.stageId,purchase.childId])).rows,blocks=(await f.pool.query('SELECT id FROM ls_fishing_stage.block_acceptances WHERE workspace_id=$1 AND stage_id=$2 AND learner_id=$3',[f.workspaceId,f.ref.stageId,purchase.childId])).rows;if(fits.length!==1||blocks.length!==1)throw Error('EXACT_SYNTHETIC_PURCHASE_REFERENCES_REQUIRED');const payment=await f.paymentStore.readPayment(f.owner,purchase.id);if(!payment)throw Error('SYNTHETIC_PAYMENT_REQUIRED');
   const result=await f.program.confirmEnrollment(f.owner,{commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,purchaseId:purchase.id,fitDecisionId:fits[0]!.id,termsAcceptanceId:blocks[0]!.id,policyApprovalId:f.policyId,expectedPaymentRevision:payment.revision});enrolled.push({...purchase,enrollmentId:result.id});
  }families.push({...family,purchases:enrolled});}
  await f.publish();const ownerSelection:FishingCalendarSelection={learnerId:null,enrollmentId:null,reference:f.ref},legacy=[];
  // Existing-shape pending warnings must remain byte-identical, not silently
  // reclassified when the new explicit no-pickup option is used later.
  for(const family of families){const plan=(await f.stage(f.owner).read(f.owner,f.ref))!,o=plan.occurrences[0]!,command:SafetyCommand={action:'safety_intervention',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,enrollmentId:family.purchases[0]!.enrollmentId,decision:'warning',reason:'PRIVATE_SYNTHETIC_LEGACY_WARNING_'+family.locale,supervisingAdult:'Synthetic instructor',handoff:'awaiting_authorized_guardian'};await f.stage(f.owner).execute(f.owner,f.ref,command);legacy.push(command);}
  const login=async(email:string)=>{const pre=await f.auth.preauth();return(await f.auth.login(email,'Ab12cd',pre.token,randomUUID())).token;},ownerToken=await login(f.owner.id+'@example.invalid'),parentTokens=await Promise.all(families.map(family=>login(family.parentEmail))),prefix='/api/calendar/fishing/';
  const get=async(selection=ownerSelection,token=ownerToken)=>{const response=await handleFishingCalendar(new Request(origin+prefix+'plan?'+fishingCalendarSearch(selection),{headers:{cookie:SESSION_COOKIE+'='+token}}),['plan'],async()=>({runtime:f.runtime,store:f.db}));return response;};
  const plan=async()=>{const r=await get();if(r.status!==200)throw Error('ACTUAL_CALENDAR_READ_'+r.status);return(await r.json()).data as FishingCalendarPlan;};
  const body=(command:SafetyCommand,selection=ownerSelection)=>({selection,command,intent:{operationId:command.operationId,resources:[],makeupFitDecisionId:null}});
  const post=(command:SafetyCommand,token=ownerToken,selection=ownerSelection,extra:Record<string,string>={})=>handleFishingCalendar(new Request(origin+prefix+'command',{method:'POST',headers:{cookie:SESSION_COOKIE+'='+token,origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':f.sessions.csrf(token),'idempotency-key':command.operationId,...extra},body:JSON.stringify(body(command,selection))}),['command'],async()=>({runtime:f.runtime,store:f.db}));
  const current=async(family=families[0]!)=>{const p=await plan(),o=p.view!.occurrences[0]!;return{operationId:randomUUID(),expectedRevision:p.view!.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,enrollmentId:family.purchases[0]!.enrollmentId};};
  const legacySnapshot=async()=>(await f.pool.query('SELECT to_jsonb(r) AS row FROM ls_fishing_stage.revisions r WHERE workspace_id=$1 ORDER BY to_jsonb(r)::text',[f.workspaceId])).rows;
  return{...f,families,legacy,legacySnapshot,ownerSelection,ownerToken,parentTokens,get,plan,post,current,body};
 }catch(error){await f.close();throw error;}
}
