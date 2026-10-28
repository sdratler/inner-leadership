import {createHash} from "node:crypto";
import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";

export const BNA_LEAD_SCHEMA_MIGRATIONS=Object.freeze([
 {name:"0138_ls_academy_crm.sql",sha256:"0598f09b6653089664ffe8be283232fa2d7ea927989754d9c704ff3e09480fbf"},
 {name:"0139_ls_bna_inquiries.sql",sha256:"91421da4a936986e9c33e4ccbe141c07f78cbaeca3f6d55bf0e34fd243e64da0"},
] as const);
export const BNA_LEAD_SCHEMA_BASELINE={name:"0137_ls_academy_owner_notifications.sql",
 sha256:"b474d4f21eec0b39cb0796e9afac1226335108bc20dd334bf005c01aa775a506"} as const;
export const bnaLeadHash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
export function bnaLeadSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const ordered=[...files].sort((a,b)=>a.name.localeCompare(b.name));
 const indexes=BNA_LEAD_SCHEMA_MIGRATIONS.map(expected=>ordered.findIndex(file=>file.name===expected.name&&file.checksum===expected.sha256));
 if(indexes[0]!<1||indexes[1]!==indexes[0]!+1)throw Error("BNA_LEAD_SCHEMA_SOURCE_MISMATCH");
 const previous=ordered[indexes[0]!-1];if(previous?.name!==BNA_LEAD_SCHEMA_BASELINE.name||previous.checksum!==BNA_LEAD_SCHEMA_BASELINE.sha256)throw Error("BNA_LEAD_SCHEMA_BASELINE_MISMATCH");
 const scoped=ordered.slice(0,indexes[1]!+1),pending=planMigrations(scoped,history);
 const expected=stage===0?BNA_LEAD_SCHEMA_MIGRATIONS.map(file=>file.name):[];
 if(JSON.stringify(pending.map(file=>file.name))!==JSON.stringify(expected))throw Error("BNA_LEAD_SCHEMA_LEDGER_STATE_CONFLICT");
 return {pending,scoped};
}
export interface BnaLeadReleaseQuery{query<T extends object>(sql:string,values?:readonly unknown[]):Promise<{rows:T[]}>}
export async function readBnaLeadSchemaStage(db:BnaLeadReleaseQuery):Promise<0|1>{
 const rows=await db.query<{academy_contacts:string|null;academy_activity:string|null;bna_inquiries:string|null;bna_operations:string|null;bna_followups:string|null;phase:string|null;action:string|null}>(`SELECT
  to_regclass('ls_contact_ops.academy_crm_contacts')::text AS academy_contacts,
  to_regclass('ls_contact_ops.academy_crm_activity')::text AS academy_activity,
  to_regclass('ls_service_interest.bna_inquiries')::text AS bna_inquiries,
  to_regclass('ls_service_interest.bna_inquiry_operations')::text AS bna_operations,
  to_regclass('ls_service_interest.bna_inquiry_followups')::text AS bna_followups,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='ls_contact_ops.cutover'::regclass AND conname='cutover_phase_check') AS phase,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='ls_contact_ops.cutover_history'::regclass AND conname='cutover_history_action_check') AS action`);
 const row=rows.rows[0];if(!row||!row.phase||!row.action)throw Error("BNA_LEAD_SCHEMA_CATALOG_CONFLICT");
 const names=[row.academy_contacts,row.academy_activity,row.bna_inquiries,row.bna_operations,row.bna_followups];
 if(names.every(value=>value===null)&&!row.phase.includes("academy_native")&&!row.action.includes("initialize_academy"))return 0;
 if(names.some(value=>value===null)||!row.phase.includes("academy_native")||!row.action.includes("initialize_academy"))throw Error("BNA_LEAD_SCHEMA_CATALOG_CONFLICT");
 const state=await db.query<{academy_contacts:number;academy_activity:number;bna_inquiries:number;bna_operations:number;bna_followups:number;triggers:number;constraints:number}>(`SELECT
  (SELECT count(*)::int FROM ls_contact_ops.academy_crm_contacts) AS academy_contacts,
  (SELECT count(*)::int FROM ls_contact_ops.academy_crm_activity) AS academy_activity,
  (SELECT count(*)::int FROM ls_service_interest.bna_inquiries) AS bna_inquiries,
  (SELECT count(*)::int FROM ls_service_interest.bna_inquiry_operations) AS bna_operations,
  (SELECT count(*)::int FROM ls_service_interest.bna_inquiry_followups) AS bna_followups,
  (SELECT count(*)::int FROM pg_trigger WHERE tgname IN ('academy_crm_admission_before_insert','academy_crm_admission_no_edit','academy_crm_admission_no_truncate','academy_crm_activity_no_edit','academy_crm_activity_no_truncate','bna_inquiries_no_edit','bna_inquiry_operations_no_edit','bna_inquiry_followups_no_edit','bna_inquiries_no_truncate','bna_inquiry_operations_no_truncate','bna_inquiry_followups_no_truncate') AND NOT tgisinternal AND tgenabled IN ('O','A')) AS triggers,
  (SELECT count(*)::int FROM pg_constraint WHERE conname IN ('bna_inquiries_pkey','bna_inquiry_operations_pkey','bna_inquiry_followups_pkey','academy_crm_contacts_pkey','academy_crm_activity_pkey')) AS constraints`);
 const stateRow=state.rows[0];if(!stateRow||Object.entries(stateRow).some(([key,value])=>
  key==="triggers"?value!==11:key==="constraints"?value!==5:!Number.isSafeInteger(value)||value<0))throw Error("BNA_LEAD_SCHEMA_CATALOG_CONFLICT");
 return 1;
}
