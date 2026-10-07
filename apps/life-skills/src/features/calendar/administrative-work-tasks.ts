import {AppError} from '../../lib/errors.ts';
import {asId,type CaseId} from '../../lib/ids.ts';
import type {CalendarStore,TransactionContext} from './store.ts';
import type {FollowupSource} from './followups.ts';
import {MAX_OPERATIONAL_PROSPECTS} from '../contact-ops/core/limits.ts';
import {prospectArchived,prospectContactSuppressed} from '../prospects/native-edit.ts';
import {administrativeTaskTitle} from './administrative-work-copy.ts';
import {reconcileAdministrativeSources,type AdministrativeWorkSource} from './source-work-tasks.ts';

/** Only current authoritative CRM identities are eligible. Imported form/payment/
 * booking labels never qualify. Read receipt + native ledger + appointment facts
 * in this workspace transaction; no answers, provider payloads or clinical data. */
export async function reconcileIntakeWork(db:CalendarStore,c:TransactionContext,rows:readonly FollowupSource[],digest:(value:unknown)=>string){
 if(rows.length>MAX_OPERATIONAL_PROSPECTS)throw new AppError('UNAVAILABLE');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const leads=rows.map(row=>({leadId:row.leadId,caseId:typeof row.caseId==='string'&&uuid.test(row.caseId)?row.caseId:null})),byLead=new Map(rows.map(row=>[row.leadId,row]));
 const facts=await c.tx.query<{leadId:string;receiptId:string;receivedDate:string;caseId:CaseId|null;eligible:boolean;caseArchived:boolean;paymentVerified:boolean;bookingConfirmed:boolean}>(`SELECT j.stable_lead_ref AS "leadId",r.receipt_id::text AS "receiptId",(r.received_at AT TIME ZONE 'Asia/Jerusalem')::date::text AS "receivedDate",COALESCE(o.case_id,crm_case.id) AS "caseId",
   ((cl.id IS NULL OR cl.practitioner_account_id=$3) AND (o.case_id IS NULL OR crm_case.id IS NULL OR o.case_id=crm_case.id)) AS eligible,
   COALESCE(cl.state='archived',false) AS "caseArchived",
   EXISTS(SELECT 1 FROM ls_onboarding.payment_allocations a WHERE a.workspace_id=j.workspace_id AND a.order_id=j.first_session_order_id
    AND NOT EXISTS(SELECT 1 FROM ls_onboarding.payment_reversals pr WHERE pr.workspace_id=a.workspace_id AND pr.provider_account_id=a.provider_account_id AND pr.transaction_id=a.transaction_id)) AS "paymentVerified",
   EXISTS(WITH RECURSIVE linked AS (
    SELECT id,status FROM ls_calendar.appointments WHERE workspace_id=j.workspace_id AND id=j.confirmed_appointment_id AND case_id=COALESCE(o.case_id,crm_case.id)
    UNION SELECT replacement.id,replacement.status FROM ls_calendar.appointments replacement JOIN linked prior ON replacement.original_id=prior.id
     WHERE replacement.workspace_id=j.workspace_id AND replacement.case_id=COALESCE(o.case_id,crm_case.id)
   ) SELECT 1 FROM linked WHERE status IN('scheduled','completed')) AS "bookingConfirmed"
  FROM ls_onboarding.prospect_journeys j JOIN ls_intake.pre_enrollment_receipts r ON r.workspace_id=j.workspace_id AND r.receipt_id=j.intake_receipt_id
  JOIN jsonb_to_recordset($2::jsonb) AS lead("leadId" text,"caseId" uuid) ON lead."leadId"=j.stable_lead_ref
  LEFT JOIN ls_cases.cases crm_case ON crm_case.workspace_id=j.workspace_id AND crm_case.id=lead."caseId"
  LEFT JOIN ls_onboarding.first_session_orders o ON o.workspace_id=j.workspace_id AND o.order_id=j.first_session_order_id
  LEFT JOIN ls_cases.cases cl ON cl.workspace_id=j.workspace_id AND cl.id=COALESCE(o.case_id,crm_case.id)
  WHERE j.workspace_id=$1
   AND NOT EXISTS(SELECT 1 FROM ls_demo.records d WHERE d.workspace_id=j.workspace_id AND d.entity_kind='prospect' AND d.entity_key=j.stable_lead_ref)
   AND NOT EXISTS(SELECT 1 FROM ls_demo.accounts d WHERE d.workspace_id=j.workspace_id AND d.account_id=j.account_id)
   AND NOT EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=j.workspace_id AND d.case_id=COALESCE(o.case_id,crm_case.id))
   AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.legacy_links l JOIN ls_contact_ops.profiles p ON p.workspace_id=l.workspace_id AND p.person_id=l.person_id WHERE l.workspace_id=j.workspace_id AND l.legacy_lead_id=j.stable_lead_ref AND p.record_mode='demo')
  ORDER BY j.stable_lead_ref LIMIT $4`,[c.workspace,JSON.stringify(leads),c.actor.id,MAX_OPERATIONAL_PROSPECTS+1]);
 if(facts.length>MAX_OPERATIONAL_PROSPECTS)throw new AppError('UNAVAILABLE');
 const sources:AdministrativeWorkSource[]=[];
 for(const fact of facts){
  const row=byLead.get(fact.leadId);if(!row||!fact.eligible)continue;
  const suppressed=prospectArchived(row)||prospectContactSuppressed(row)||fact.caseArchived,caseId=fact.caseId?asId(fact.caseId,'case'):null;
  const identity=(typeof row.name==='string'&&row.name.trim()?row.name.trim():row.leadId).slice(0,64);
  const sourcePath='/en/app/clients?'+new URLSearchParams({section:'prospects',leadId:row.leadId});
  // Only task-relevant active state and the immutable receipt identity affect
  // revisions. An already-resolved intake is not resolved again merely because
  // the later booking changed. No copied money/booking status becomes authority.
  const common={sourceId:row.leadId,caseId,sourcePath,dueDate:fact.receivedDate,revisionFacts:{receiptId:fact.receiptId}};
  // This is follow-up work, not a second intake acceptance. The only transition
  // to paid/booking work is an allocation without an actual reversal. The date
  // stays the originating submitted-intake date, not a fabricated paid time.
  sources.push({...common,kind:'intake_followup',title:administrativeTaskTitle('intake_followup',identity),active:!suppressed&&!fact.paymentVerified&&!fact.bookingConfirmed});
  sources.push({...common,kind:'booking_followup',title:administrativeTaskTitle('booking_followup',identity),active:!suppressed&&fact.paymentVerified&&!fact.bookingConfirmed});
 }
 return reconcileAdministrativeSources(db,c,sources,digest);
}
