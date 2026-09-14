import { randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import { asId } from '../../lib/ids.ts';
import { one,type SqlSession } from '../identity/store.ts';
import { APPOINTMENT_RATE_MINOR,bodyDigest,calendarDisposition,creditReason } from './policy.ts';
import { parseCreditEffect } from './validation.ts';
interface CalendarEventMeta {id:string;sequence:number;workspaceId:string;appointmentId:string;}
/** A stale consume may be acknowledged without movement only when a later durable
 * calendar preservation proves the correction. Merely seeing new facts is not enough.
 */
async function supersedingPreservation(tx:SqlSession,meta:CalendarEventMeta,reference:ReturnType<typeof parseCreditEffect>){
 try{
  const later=await one<{payload:{reference:unknown}}>(tx,`SELECT payload FROM ls_calendar.events
   WHERE workspace_id=$1 AND appointment_id=$2 AND topic='credit_effect' AND sequence>$3
    AND payload->'reference'->>'effect'='preserve' ORDER BY sequence LIMIT 1`,[meta.workspaceId,meta.appointmentId,meta.sequence]);
  if(!later)throw new AppError('CONFLICT');
  const correction=parseCreditEffect(later.payload.reference);
  if(correction.effect!=='preserve'||correction.appointmentId!==reference.appointmentId||correction.caseId!==reference.caseId||correction.termsVersion!==reference.termsVersion)throw new AppError('CONFLICT');
 }catch(error){if(error instanceof AppError)throw error;throw new AppError('UNAVAILABLE');}
}
/** DATABASE-ONLY LS-030 relay consumer. Call inside drainCalendarEvents; never from a provider or browser. */
export async function applyCalendarCreditEffect(tx:SqlSession,event:unknown,meta:CalendarEventMeta):Promise<void>{
 if(!event||typeof event!=='object'||!('type' in event)||event.type!=='credit_effect'||!('reference' in event)||!meta.id||!Number.isSafeInteger(meta.sequence)||meta.sequence<1)throw new AppError('INVALID_REQUEST');
 const reference=parseCreditEffect(event.reference),workspace=asId(meta.workspaceId,'workspace'),appointmentId=asId(meta.appointmentId,'appointment');
 if(reference.appointmentId!==appointmentId)throw new AppError('CONFLICT');const digest=bodyDigest(reference);
 const receipt=await one<{effect:string;eventDigest:string}>(tx,'SELECT effect,event_digest AS "eventDigest" FROM ls_payments.calendar_receipts WHERE workspace_id=$1 AND event_key=$2',[workspace,reference.idempotencyKey]);
 if(receipt){if(receipt.effect!==reference.effect||receipt.eventDigest!==digest)throw new AppError('CONFLICT');return;}
 const facts=await one<{caseId:string;kind:'individual'|'parent_guidance';termsVersion:string;noticeEligibility:'credit_preserved'|'late_notice'|null;attendanceState:'present'|'late'|'no_show'|'canceled'|null;exceptionReason:'practitioner_exception'|'provider_unavailable'|null}>(tx,`SELECT a.case_id AS "caseId",a.kind,a.terms_version AS "termsVersion",(SELECT n.eligibility FROM ls_calendar.notices n WHERE n.workspace_id=a.workspace_id AND n.appointment_id=a.id ORDER BY n.received_at,n.id LIMIT 1) AS "noticeEligibility",(SELECT r.state FROM ls_attendance.records r WHERE r.workspace_id=a.workspace_id AND r.appointment_id=a.id) AS "attendanceState",(SELECT x.reason_code FROM ls_calendar.credit_exceptions x WHERE x.workspace_id=a.workspace_id AND x.appointment_id=a.id) AS "exceptionReason" FROM ls_calendar.appointments a WHERE a.workspace_id=$1 AND a.id=$2`,[workspace,appointmentId]);
 if(!facts||facts.caseId!==reference.caseId||facts.termsVersion!==reference.termsVersion)throw new AppError('CONFLICT');
 const consumed=await one<{blockId:string}>(tx,`SELECT credit_block_id AS "blockId" FROM ls_payments.credit_events WHERE workspace_id=$1 AND appointment_id=$2 AND kind='consume'`,[workspace,appointmentId]);
 let effectiveEffect=reference.effect;
 if(!consumed&&(facts.noticeEligibility==='credit_preserved'||facts.exceptionReason!==null)){
  if(reference.effect==='consume'){
   await supersedingPreservation(tx,meta,reference);effectiveEffect='preserve';
  }else if(reference.effect==='restore'){
   // Calendar emits restore when a consume was queued, not necessarily debited.
   // Require acknowledged earlier consume AND preservation; never mint a credit.
   const prior=await one(tx,`SELECT c.id FROM ls_payments.calendar_receipts c
    WHERE c.workspace_id=$1 AND c.appointment_id=$2 AND c.effect='consume' AND c.calendar_sequence<$3
     AND EXISTS(SELECT 1 FROM ls_payments.calendar_receipts p WHERE p.workspace_id=c.workspace_id
      AND p.appointment_id=c.appointment_id AND p.effect='preserve' AND p.calendar_sequence>c.calendar_sequence AND p.calendar_sequence<$3)`,[workspace,appointmentId,meta.sequence]);
   if(!prior)throw new AppError('CONFLICT');effectiveEffect='preserve';
  }
 }
 const disposition=calendarDisposition(effectiveEffect,{...facts,priorConsumed:Boolean(consumed)}),reason=creditReason(disposition,{...facts,priorConsumed:Boolean(consumed)});
 if(disposition!=='preserve'){
  let blockId:string;
  if(disposition==='restore')blockId=consumed!.blockId;
  else{
   const block=await one<{id:string}>(tx,`SELECT b.id FROM ls_payments.credit_blocks b WHERE b.workspace_id=$1 AND b.case_id=$2 AND (SELECT COALESCE(SUM(e.delta_credits),0) FROM ls_payments.credit_events e WHERE e.workspace_id=b.workspace_id AND e.credit_block_id=b.id)>0 ORDER BY b.purchased_at,b.id LIMIT 1 FOR UPDATE`,[workspace,reference.caseId]);
   if(!block)throw new AppError('CONFLICT');blockId=block.id;
  }
  const delta=disposition==='consume'?-1:1,value=delta*APPOINTMENT_RATE_MINOR;
  await tx.query(`INSERT INTO ls_payments.credit_events(id,workspace_id,case_id,credit_block_id,kind,delta_credits,value_minor,appointment_id,reschedule_request_id,event_key,reason_code,actor_account_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[randomUUID(),workspace,reference.caseId,blockId,disposition,delta,value,appointmentId,reference.rescheduleRequestId,reference.idempotencyKey,reason,reference.actorAccountId,reference.occurredAt]);
 }
 await tx.query('INSERT INTO ls_payments.calendar_receipts(id,workspace_id,case_id,appointment_id,calendar_event_id,calendar_sequence,event_key,effect,event_digest,applied_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())',[randomUUID(),workspace,reference.caseId,appointmentId,meta.id,meta.sequence,reference.idempotencyKey,reference.effect,digest]);
}
