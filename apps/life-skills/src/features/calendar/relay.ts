import type { SqlSession } from '../identity/store.ts';
import type { CalendarEvent } from './types.ts';
import type { TransactionContext } from './store.ts';
import { asId } from '../../lib/ids.ts';
/** Integration-only seam. The application does not run a scheduler or register a consumer here.
 * Call inside CalendarStore.read (workspace lock already held), with a durable DATABASE-ONLY consumer.
 * The consumer must apply its own dedupe key and changes on the supplied transaction, then return.
 * Never call an external provider here; LS-090 must enqueue into its own outbox in this transaction.
 * Topic-specific processors preserve sequence within that topic and appointment. LS-060 consumes only credit_effect.
 */
export async function drainCalendarEvents(c:TransactionContext,topic:CalendarEvent['type'],apply:(tx:SqlSession,event:CalendarEvent,meta:{id:string;sequence:number;workspaceId:string;appointmentId:string})=>Promise<void>,limit=25):Promise<number>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid event batch');
 const rows=await c.tx.query<{id:string;appointmentId:string;sequence:number;payload:CalendarEvent}>(`SELECT id,appointment_id AS "appointmentId",sequence,payload FROM ls_calendar.events
  WHERE workspace_id=$1 AND topic=$2 AND delivered_at IS NULL ORDER BY appointment_id,sequence LIMIT $3 FOR UPDATE`,[c.workspace,topic,limit]);
 for(const row of rows){
  await apply(c.tx,row.payload,{id:row.id,sequence:row.sequence,workspaceId:c.workspace,appointmentId:row.appointmentId});
  await c.tx.query('UPDATE ls_calendar.events SET delivered_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 AND delivered_at IS NULL',[c.workspace,row.id]);
 }
 return rows.length;
}

/** Request-driven integration drain. The original all-or-nothing seam above remains available.
 * A savepoint keeps each database effect and delivery mark atomic. Failed appointments
 * stay pending and cool down durably, so even a full failed batch cannot starve others.
 * Only a just-authorized command may name its appointment for immediate retry.
 * This installs no scheduler, touches no provider and exposes no payload/error text.
 */
export async function drainCalendarEventsIsolated(
 c:TransactionContext,topic:CalendarEvent['type'],
 apply:(tx:SqlSession,event:CalendarEvent,meta:{id:string;sequence:number;workspaceId:string;appointmentId:string})=>Promise<void>,
 limit=25,retryAppointmentId:string|null=null,
):Promise<{delivered:number;deferred:number}>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid event batch');
 if(retryAppointmentId!==null)asId(retryAppointmentId,'appointment');
 const blocked=new Set<string>();let delivered=0,deferred=0;
 for(let attempt=0;attempt<limit;attempt++){
  const rows=await c.tx.query<{id:string;appointmentId:string;sequence:number;payload:CalendarEvent}>(`SELECT e.id,e.appointment_id AS "appointmentId",e.sequence,e.payload
   FROM ls_calendar.events e LEFT JOIN ls_integration.calendar_delivery_attempts d ON d.workspace_id=e.workspace_id AND d.event_id=e.id
   WHERE e.workspace_id=$1 AND e.topic=$2 AND e.delivered_at IS NULL
    AND NOT(e.appointment_id=ANY($3::uuid[]))
    AND (d.retry_after IS NULL OR d.retry_after<=clock_timestamp() OR e.appointment_id=$4::uuid)
    AND NOT EXISTS(SELECT 1 FROM ls_calendar.events earlier WHERE earlier.workspace_id=e.workspace_id
     AND earlier.appointment_id=e.appointment_id AND earlier.topic=e.topic AND earlier.delivered_at IS NULL AND earlier.sequence<e.sequence)
   ORDER BY COALESCE(d.last_attempted_at,e.created_at),e.id LIMIT 1 FOR UPDATE OF e`,[c.workspace,topic,[...blocked],retryAppointmentId]);
  const row=rows[0];if(!row)break;
  await c.tx.query('SAVEPOINT ls070_calendar_delivery');
  try{
   await apply(c.tx,row.payload,{id:row.id,sequence:row.sequence,workspaceId:c.workspace,appointmentId:row.appointmentId});
   await c.tx.query('UPDATE ls_calendar.events SET delivered_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 AND delivered_at IS NULL',[c.workspace,row.id]);
   await c.tx.query('RELEASE SAVEPOINT ls070_calendar_delivery');delivered++;
  }catch{
   await c.tx.query('ROLLBACK TO SAVEPOINT ls070_calendar_delivery');
   await c.tx.query('RELEASE SAVEPOINT ls070_calendar_delivery');
   await c.tx.query(`INSERT INTO ls_integration.calendar_delivery_attempts(workspace_id,event_id,attempts,last_attempted_at,retry_after,failure_code)
    VALUES($1,$2,1,clock_timestamp(),clock_timestamp()+interval '60 seconds','deferred')
    ON CONFLICT(workspace_id,event_id) DO UPDATE SET attempts=LEAST(ls_integration.calendar_delivery_attempts.attempts,2147483646)+1,
     last_attempted_at=clock_timestamp(),retry_after=clock_timestamp()+interval '60 seconds',failure_code='deferred'`,[c.workspace,row.id]);
   blocked.add(row.appointmentId);deferred++;
  }
 }
 return {delivered,deferred};
}
