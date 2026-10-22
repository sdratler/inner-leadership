/** Synthetic loopback only; existing real native login/Stage transactions.
 * Source approvals and venue permissions are the fixture's artificial records.
 * This does not approve a real group, Keys trip, provider or curriculum.
 */
import {randomUUID} from 'node:crypto';
import {programFixture} from './native-program-fixture.ts';
import {digest} from '../../../src/features/fishing-payments/domain.ts';
import {floridaWallTimeCandidates} from '../../../src/features/fishing-stage/time.ts';
import {academyFloridaDay} from '../../../src/features/fishing/academy-operator-day.ts';
import type {FishingStageRef,StageCommand} from '../../../src/features/fishing-stage/contract.ts';
import {AcademyGroupCalendarService} from '../../../src/features/fishing/academy-group-calendar-service.ts';
import {academyGroupCalendarVersion,type AcademyGroupDraftCommand} from '../../../src/features/fishing/academy-group-calendar-contract.ts';
import {IdentityAuthService} from '../../../src/features/identity/auth-service.ts';
import {IdentitySessions} from '../../../src/features/identity/session-adapter.ts';
import {PostgresIdentityRateStore} from '../../../src/features/identity/rate-store.ts';
import {durableAuditSink} from '../../../src/features/identity/history.ts';
import {systemClock,type IdentityClock,type Actor} from '../../../src/features/identity/types.ts';
import type {MerchantBinding} from '../../../src/features/fishing-payments/domain.ts';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
import {handleFishingCalendar} from '../../../src/features/fishing/program-calendar-http.ts';

export async function groupCalendarFixture(options:Parameters<typeof programFixture>[0]={}){
 const f=await programFixture(options);
 try{
  const today=academyFloridaDay(new Date().toISOString()),d=new Date(today+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+((8-d.getUTCDay())%7||7));const monday=d.toISOString().slice(0,10);
  await f.pool.query("UPDATE ls_calendar.availability SET starts_at=clock_timestamp()-interval '15 days',ends_at=clock_timestamp()+interval '15 days' WHERE workspace_id=$1 AND practitioner_id=$2",[f.workspaceId,f.owner.id]);
  const wall=(date:string,hour:number)=>{const found=floridaWallTimeCandidates(`${date}T${String(hour).padStart(2,'0')}:00`);if(found.length!==1)throw Error('SYNTHETIC_UNAMBIGUOUS_TIME_REQUIRED');return found[0]!;};
  async function group(){const ref={...f.ref,cohortId:randomUUID(),stageId:randomUUID()};await f.program.createCohort(f.owner,{...f.cohortCommand,...ref,commandId:randomUUID(),label:'Synthetic additional group'});
   await f.stage().execute(f.owner,ref,{action:'create',operationId:randomUUID(),expectedRevision:0,templateVersion:f.template.version,childCapacity:f.cohortCommand.approvedChildCapacity});return ref;
  }
  const read=(ref:FishingStageRef)=>f.stage().read(f.owner,ref);
  async function schedule(ref:FishingStageRef,start:number,end:number,date=monday,ordinal=1){const p=(await read(ref))!,o=p.occurrences.find(o=>o.ordinal===ordinal)!,operationId=randomUUID();
   const command:StageCommand={action:'revise',operationId,expectedRevision:p.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'Synthetic prospective placement',details:{time:{kind:'scheduled',startsAt:wall(date,start),endsAt:wall(date,end),timeZone:'America/New_York'},location:f.venueCommand.label,directions:'Synthetic',equipment:'Synthetic',logisticalNote:'Synthetic',childCapacity:f.cohortCommand.approvedChildCapacity}};
   return f.stage(f.owner,null,{operationId,resources:[{occurrenceId:o.id,expectedRevision:o.revision,venueId:f.venueCommand.id}],makeupFitDecisionId:null}).execute(f.owner,ref,command);
  }
  async function publication(ref:FishingStageRef){const p=(await read(ref))!,operationId=randomUUID(),command:StageCommand={action:'publish',operationId,expectedRevision:p.revision};
   const execute=()=>f.stage(f.owner,null,{operationId,resources:[],makeupFitDecisionId:null}).execute(f.owner,ref,command);return {command,execute};
  }
  async function action(ref:FishingStageRef,kind:'complete'|'cancel',ordinal=1){const p=(await read(ref))!,o=p.occurrences.find(o=>o.ordinal===ordinal)!,operationId=randomUUID();
   return f.stage(f.owner,null,{operationId,resources:[],makeupFitDecisionId:null}).execute(f.owner,ref,{action:kind,operationId,expectedRevision:p.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'Synthetic completed or cancelled instruction'});
  }
  async function snapshot(){const tables=['plans','occurrences','revisions','command_receipts','resource_reservations','seat_reservations','makeup_links','cohorts','enrollments','terms_acceptances','block_acceptances','refund_cancellations','refund_fee_reservations','refund_preparations','refund_preparation_members'];const values:Record<string,string>={};
   for(const table of tables){const rows=(await f.pool.query(`SELECT row_to_json(t) AS value FROM ls_fishing_stage.${table} t WHERE workspace_id=$1`,[f.workspaceId])).rows.map(r=>JSON.stringify(r.value)).sort();values[table]=digest(rows);}return values;
  }
  const planning=()=>new AcademyGroupCalendarService(f.db,f.config),query={from:monday.slice(0,7),to:monday.slice(0,7)};
  async function draft(refs:readonly FishingStageRef[]=[]):Promise<AcademyGroupDraftCommand>{const context=await planning().context(f.owner,query);return {version:academyGroupCalendarVersion,action:'save_draft',operationId:randomUUID(),eventId:randomUUID(),expectedRevision:0,calendarMonth:query.from,label:'PRIVATE_SYNTHETIC_POOLED_KEYS',placement:{kind:'needs_placement',reason:'Synthetic pending source/site/adult/guardian review'},originals:refs.map(ref=>{const g=context.groups.find(g=>g.stageId===ref.stageId);if(!g)throw Error('SYNTHETIC_PLANNING_GROUP_REQUIRED');return g.originals[0]!.selection;})};}
  async function planningRows(){const values:Record<string,string>={};for(const table of ['events','event_revisions','original_links','commands']){const rows=(await f.pool.query(`SELECT row_to_json(t) AS value FROM ls_academy_calendar.${table} t WHERE workspace_id=$1`,[f.workspaceId])).rows.map(r=>JSON.stringify(r.value)).sort();values[table]=digest(rows);}return values;}
  async function planningHttp(target='group-events',merchant?:MerchantBinding|null,clock:IdentityClock=systemClock,account:Actor=f.owner){const auth=new IdentityAuthService(f.db,f.config,systemClock),sessions=new IdentitySessions(f.db,f.config,systemClock),preauth=await auth.preauth(),login=await auth.login(`${account.id}@example.invalid`,'Ab12cd',preauth.token,randomUUID()),runtime={config:f.config,sessions,limits:new PostgresIdentityRateStore(f.db),audit:durableAuditSink(f.db),clock},path='/api/calendar/fishing/'+target;
   const get=(suffix='?'+new URLSearchParams(query))=>handleFishingCalendar(new Request(f.config.origin+path+suffix,{headers:{cookie:SESSION_COOKIE+'='+login.token}}),[target],async()=>({runtime,store:f.db,...(merchant===undefined?{}:{merchant})}));
   const post=(body:unknown,headers:Record<string,string>={})=>handleFishingCalendar(new Request(f.config.origin+path,{method:'POST',headers:{cookie:SESSION_COOKIE+'='+login.token,origin:f.config.origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':sessions.csrf(login.token),'idempotency-key':(body as {operationId:string}).operationId,...headers},body:JSON.stringify(body)}),[target],async()=>({runtime,store:f.db,...(merchant===undefined?{}:{merchant})}));return {get,post};
  }
  return {...f,monday,wall,group,read,schedule,publication,action,snapshot,planning,query,draft,planningRows,planningHttp};
 }catch(error){await f.close();throw error;}
}
