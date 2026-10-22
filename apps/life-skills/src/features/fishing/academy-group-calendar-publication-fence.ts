import 'server-only';
import {AppError} from '../../lib/errors.ts';
import type {Keyring} from '../identity/crypto.ts';
import {one,type SqlSession} from '../identity/store.ts';
import {AcademyGroupCalendarStore} from './academy-group-calendar-store.ts';
import {AcademyGroupPublicationStore} from './academy-group-calendar-publication-store.ts';
import {academyFloridaDay,type AcademyTeachingEvent} from './academy-operator-day.ts';
import type {AcademyKeysPublication} from './academy-group-calendar-publication-contract.ts';
import type {StageCommand,StageState} from '../fishing-stage/contract.ts';

/** One current physical identity per event, authenticated against immutable
 * draft/review/link/member bodies and current reservations. Revoking source
 * approval never silently releases an existing booking or erases its history.
 * Caller already owns the native/common workspace transaction lock. */
export async function readAcademySharedPhysicalEvents(tx:SqlSession,ring:Keyring,workspace:string):Promise<AcademyKeysPublication[]>{
 const store=new AcademyGroupPublicationStore(tx,ring);if(!await store.configured())return [];
 const rows=await tx.query<{eventId:string;revision:number}>(`SELECT p.event_id AS "eventId",p.revision FROM ls_academy_calendar.publications p WHERE p.workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM ls_academy_calendar.publications n WHERE n.workspace_id=p.workspace_id AND n.event_id=p.event_id AND n.revision>p.revision) ORDER BY p.event_id LIMIT 1001 FOR SHARE OF p`,[workspace]);
 if(rows.length>1000)throw new AppError('UNAVAILABLE');
 const values:AcademyKeysPublication[]=[],originals=new Set<string>();
 for(const row of rows){const saved=await store.publication(workspace,row.eventId,row.revision);if(!saved)throw new AppError('UNAVAILABLE');await store.currentResources(saved.record);
  for(const o of saved.record.originals){if(originals.has(o.selection.occurrenceId))throw new AppError('UNAVAILABLE');originals.add(o.selection.occurrenceId);}values.push(saved.record);
 }return values;
}

/** Original module/lesson identity is retained. Its old physical endpoint must
 * not revise, complete, attend, or grant a makeup for the replacement trip.
 * The explicit shared-event/rights paths perform those current operations.
 * This check also precedes cached Stage receipts. */
export function assertAcademyOriginalCommandUnbound(events:readonly AcademyKeysPublication[],plan:StageState|null,command:StageCommand){
 const bound=new Set(events.flatMap(e=>e.originals.map(o=>o.selection.occurrenceId)));
 // A historical pending intervention must remain closable after displacement
 // or cancellation. This permits only its exact original/enrollment handoff;
 // normal native safety/context/CAS rules still run, including on replay.
 // It does not admit a new assessment/intervention for the physical trip.
 if(command.action==='safety_handoff'&&plan?.safety?.interventions.some(i=>i.id===command.interventionId&&i.occurrenceId===command.occurrenceId&&i.enrollmentId===command.enrollmentId&&i.handoff==='awaiting_authorized_guardian'))return;
 const targets:string[]=[];
 if('occurrenceId'in command)targets.push(command.occurrenceId);
 if(command.action==='request_makeup'||command.action==='confirm_makeup'){
  const notice=plan?.makeups.find(m=>m.notice.id===command.noticeId);if(notice)targets.push(notice.notice.occurrenceId);
  if(command.action==='confirm_makeup')targets.push(command.replacementOccurrenceId);
 }
 if(targets.some(id=>bound.has(id)))throw new AppError('CONFLICT');
}

/** This produces physical day accounting only, never child attendance,
 * purchased service, displaced activity fulfillment, or financial effects. */
export function academySharedTeachingEvents(events:readonly AcademyKeysPublication[],operatorId:string,instructorId:string):AcademyTeachingEvent[]{
 return events.filter(e=>e.state!=='cancelled'&&(e.operatorId===operatorId||e.trip.qualifiedAdultAccountIds.includes(instructorId))).map(e=>({id:e.eventId,kind:'keys',startsAt:e.trip.startsAt,endsAt:e.trip.endsAt}));
}
export function academySharedResourceClash(events:readonly AcademyKeysPublication[],kind:'instructor'|'venue',id:string,startsAt:string,endsAt:string,exceptEventId:string|null=null){
 return events.some(e=>e.state==='published'&&e.eventId!==exceptEventId&&(kind==='venue'?e.trip.venueId===id:e.trip.qualifiedAdultAccountIds.includes(id))&&Date.parse(e.trip.startsAt)<Date.parse(endsAt)&&Date.parse(e.trip.endsAt)>Date.parse(startsAt));
}

/** Reciprocal Calendar fence receives the existing server-held keyring; it
 * discovers no key/environment and projects no private roster. Direct callers
 * without a key cannot admit a booking alongside current published history.
 * Only verified absence allows the old non-Academy behavior. A partial overlay,
 * disabled history trigger, altered function, unknown table or query failure
 * denies the booking. Claimed active reservations remain blocking even if a
 * separate publication read would find corrupt evidence. */
export async function assertNoAcademySharedInstructorConflict(tx:SqlSession,workspace:string,instructor:string,startsAt:string,endsAt:string,ring?:Keyring){
 try{
  const row=await one<{relation:number|null}>(tx,`SELECT CASE WHEN n.oid IS NULL THEN NULL WHEN c.oid IS NULL THEN 2 WHEN c.relkind='r' AND c.relnamespace=n.oid AND c.relname='resources' THEN 1 ELSE 0 END AS relation FROM(SELECT to_regnamespace('ls_academy_calendar') AS namespace,to_regclass('ls_academy_calendar.resources') AS resource) e LEFT JOIN pg_namespace n ON n.oid=e.namespace LEFT JOIN pg_class c ON c.oid=e.resource`);
  if(!row)throw new AppError('UNAVAILABLE');if(row.relation===null)return;
  if((row.relation!==1&&row.relation!==2)||!await AcademyGroupCalendarStore.catalog(tx))throw new AppError('UNAVAILABLE');
  if(row.relation===2)return;
  const busy=await one(tx,`SELECT event_id FROM ls_academy_calendar.resources WHERE workspace_id=$1 AND kind='instructor' AND resource_id=$2 AND active AND starts_at<$4::timestamptz AND ends_at>$3::timestamptz LIMIT 1 FOR SHARE`,[workspace,instructor,startsAt,endsAt]);if(busy)throw new AppError('CONFLICT');
  // Absence of a claimed reservation is not enough: a dropped/deactivated row
  // must not permit a clinical booking while sealed publication still owns it.
  if(ring){await readAcademySharedPhysicalEvents(tx,ring,workspace);}
  else if(await one(tx,`SELECT p.id FROM ls_academy_calendar.publications p WHERE p.workspace_id=$1 AND p.state='published' AND NOT EXISTS(SELECT 1 FROM ls_academy_calendar.publications n WHERE n.workspace_id=p.workspace_id AND n.event_id=p.event_id AND n.revision>p.revision) LIMIT 1 FOR SHARE OF p`,[workspace]))throw new AppError('UNAVAILABLE');
 }catch(error){if(error instanceof AppError)throw error;throw new AppError('UNAVAILABLE');}
}

export const academySharedEventFloridaDay=(event:AcademyKeysPublication)=>academyFloridaDay(event.trip.startsAt);
