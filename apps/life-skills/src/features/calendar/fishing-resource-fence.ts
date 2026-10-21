import {AppError} from "../../lib/errors.ts";
import {one,type SqlSession} from "../identity/store.ts";
import {assertNoAcademySharedInstructorConflict} from '../fishing/academy-group-calendar-publication-fence.ts';
import type {Keyring} from '../identity/crypto.ts';

/** Called inside the existing CalendarStore workspace-locked transaction.
 * Only a verified missing candidate table preserves pre-fishing behavior.
 * An unavailable catalog/query is NOT absence and must never permit a booking.
 * No resource write, provider call or clinical identifier leaves this fence.
 */
export async function assertNoFishingInstructorConflict(tx:SqlSession,workspaceId:string,instructorId:string,startsAt:string,endsAt:string,ring?:Keyring):Promise<void>{
 try{
  await assertNoAcademySharedInstructorConflict(tx,workspaceId,instructorId,startsAt,endsAt,ring);
  const catalog=await one<{relation:number|null}>(tx,`SELECT CASE WHEN c.oid IS NULL THEN NULL WHEN c.relkind='r' AND n.nspname='ls_fishing_stage' AND c.relname='resource_reservations' THEN 1 ELSE 0 END AS relation
   FROM(SELECT to_regclass('ls_fishing_stage.resource_reservations') AS oid) expected LEFT JOIN pg_class c ON c.oid=expected.oid LEFT JOIN pg_namespace n ON n.oid=c.relnamespace`);
  if(!catalog)throw new AppError("UNAVAILABLE");
  if(catalog.relation===null)return;
  if(catalog.relation!==1)throw new AppError("UNAVAILABLE");
  const busy=await one(tx,`SELECT occurrence_id FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND kind='instructor' AND resource_id=$2
   AND active AND starts_at<$4::timestamptz AND ends_at>$3::timestamptz LIMIT 1`,[workspaceId,instructorId,startsAt,endsAt]);
  if(busy)throw new AppError("CONFLICT");
 }catch(error){if(error instanceof AppError)throw error;throw new AppError("UNAVAILABLE");}
}
