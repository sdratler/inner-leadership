import {createHash} from 'node:crypto';
import {planMigrations,type AppliedMigration,type Migration} from './migration-plan.ts';

export const CONTACT_WORK_MIGRATIONS=Object.freeze([
 {name:'0119_ls_case_work_tasks.sql',sha256:'5e97f59f4b9caa07db49a6ce0549a49e25ee6a48f893ace72873038ffe034d8b'},
 {name:'0120_ls_task_workflow.sql',sha256:'f099a103f215b066417a03031d6df8ede3907238ddad3bbb2f7f154d8f6b6025'},
 {name:'0121_ls_administrative_tasks.sql',sha256:'303f8bcd33faf0c45b6a2b8c849c30eb3005fa03f5c0b84af615f8b7d7300c16'},
 {name:'0122_ls_call_activity_links.sql',sha256:'5472787029d825b464fdb0712888d60e310a666691f2c59e1a648e2223d088ff'},
 {name:'0123_ls_lead_commands.sql',sha256:'8af72dc80feda1487885907efdc1e632b4521758cc62cff092fc374986e66c30'},
 {name:'0124_ls_group_interest.sql',sha256:'51b85279639daf493f9b3312a9bafd5e82f7bbf45930903236ed23c15fbf9da5'},
 {name:'0125_ls_private_provider_index.sql',sha256:'74ada50011ab74dd150724497b206c08fef22fdf458c1d5c4aacf225eef3bbf8'},
 {name:'0126_ls_audience_interest.sql',sha256:'f2d2c2d84d34e7224e8c53fb19e4fa7e68c89d5c2d13e197f4f86b2155703845'},
]);
export const CONTACT_WORK_BASELINE={name:'0118_ls_contact_delta_history.sql',sha256:'89124785efc166f1f4aa1390f814798c2b63b71a874e37b4da10e11a7c0a202f'} as const;

export type ContactWorkStage=0|1|2|3|4|5|6|7|8;
export type ContactWorkSnapshot={
 taskColumns:number;taskConstraints:number;sourceKinds:string[];stateKinds:string[];historyActions:string[];sourceConstraintStrict:boolean;stateConstraintStrict:boolean;historyConstraintStrict:boolean;constraintDigest:string;
 workflowColumns:boolean;workflowConstraints:boolean;effectiveDueIndex:boolean;taskHistoryImmutable:boolean;taskPermissions:boolean;
 callLinksAbsent:boolean;callLinksSchema:boolean;callLinksForeignKeys:boolean;callLinksImmutable:boolean;callLinksPermissions:boolean;callLinksReferencesSound:boolean;
 leadCommandsAbsent:boolean;leadCommandsSchema:boolean;leadCommandsForeignKeys:boolean;leadCommandsImmutable:boolean;leadCommandsPermissions:boolean;leadCommandsReferencesSound:boolean;
 groupInterestAbsent:boolean;groupInterestReady:boolean;
 providerIndexAbsent:boolean;providerIndexReady:boolean;
 audienceInterestAbsent:boolean;audienceInterestReady:boolean;
 extensionDigest:string;
};
export interface ContactWorkQuery{query<R extends object=Record<string,unknown>>(sql:string,values?:readonly unknown[]):Promise<{rows:R[]}>}

const sourceStages=[
 ['crm_followup'],
 ['calendar_notice','crm_followup','form_review','report_review','session_observations','update_review'],
 ['booking_followup','calendar_notice','creative_approval','crm_followup','form_review','intake_followup','publishing_failure','report_review','session_observations','update_review'],
] as const;
const same=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const literals=(value:unknown,ignored:ReadonlySet<string>=new Set())=>typeof value==='string'?[...value.matchAll(/'([^']+)'(?:::\w+)?/g)].map(match=>match[1]!).filter(item=>!ignored.has(item)).sort():[];
const sourceIgnored=new Set(['^[0-9a-f]{64}$']);
const normalizedConstraint=(value:unknown)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().toLocaleLowerCase():'';
const strictConstraint=(value:unknown,expectedOrs:number,required:readonly RegExp[])=>typeof value==='string'&&((value.match(/\bOR\b/gi)??[]).length===expectedOrs)&&!/(?:\bTRUE\b|\bFALSE\b|\bNOT\s+IN\b)/i.test(value)&&required.every(pattern=>pattern.test(value));
const sourceStrict=(value:unknown)=>{const current=literals(value,sourceIgnored),expanded=current.length>1;return strictConstraint(value,1,[/source_kind\s+is\s+null/i,/source_digest\s+is\s+null/i,/source_revision\s+is\s+null/i,/source_kind\s*(?:=\s*'|=\s*any|in\s*\()/i,/source_digest\s*~/i,/source_revision\s*~/i,...(expanded?[/source_kind\s+is\s+not\s+null/i,/source_digest\s+is\s+not\s+null/i,/source_revision\s+is\s+not\s+null/i]:[])]);};
const stateStrict=(value:unknown)=>strictConstraint(value,0,[/state\s*(?:=\s*any|in\s*\()/i]);
const historyStrict=(value:unknown)=>strictConstraint(value,0,[/action\s*(?:=\s*any|in\s*\()/i]);
const snoozeStrict=(value:unknown)=>strictConstraint(value,1,[/snoozed_until\s+is\s+null/i,/state\s*<>\s*'done'/i]);
const historyStateStrict=(value:unknown)=>strictConstraint(value,2,[/action\s*<>\s*'managed'/i,/action\s*=\s*'managed'/i,/state_value\s+is\s+null/i,/state_value\s+is\s+not\s+null/i,/snoozed_until\s+is\s+null/i,/state_value\s*(?:=\s*any|in\s*\()/i,/state_value\s*<>\s*'done'/i]);

type ExtensionCatalogRow={kind:string;schema_name:string;object_name:string;name:string;definition:string|null;data:unknown};
type CatalogData={type?:unknown;validated?:unknown;localColumns?:unknown;referenceSchema?:unknown;referenceTable?:unknown;referenceColumns?:unknown;valid?:unknown;ready?:unknown;live?:unknown;columns?:unknown;predicate?:unknown;enabled?:unknown;internal?:unknown;functionIdentity?:unknown;language?:unknown;securityDefiner?:unknown;volatility?:unknown;parallel?:unknown;leakproof?:unknown;objectType?:unknown;grantee?:unknown;privilege?:unknown;grantable?:unknown;position?:unknown;dataType?:unknown;notNull?:unknown;defaultExpression?:unknown;identity?:unknown;generated?:unknown};
type ConstraintSpec={schema:string;table:string;name:string;type:'c'|'f'|'p'|'u';local?:readonly string[];reference?:{schema:string;table:string;columns:readonly string[]};definition?:(value:string)=>boolean};
type TriggerSpec={schema:string;table:string;name:string;fn:string;parts:readonly string[]};
const data=(row:ExtensionCatalogRow):CatalogData=>row.data&&typeof row.data==='object'?row.data as CatalogData:{};
const strings=(value:unknown):string[]=>Array.isArray(value)&&value.every(item=>typeof item==='string')?[...value]:[];
const catalogDefinition=(value:unknown)=>typeof value==='string'?value:'';
const catalogSearch=(value:unknown)=>catalogDefinition(value).replace(/\s+/g,' ').trim().toLocaleLowerCase();
const ordered=(actual:readonly string[],expected:readonly string[])=>actual.length===expected.length&&actual.every((item,index)=>item===expected[index]);
const extensionFingerprint=(rows:readonly ExtensionCatalogRow[])=>rows.map(row=>({kind:row.kind,schema:row.schema_name,object:row.object_name,name:row.name,definition:catalogDefinition(row.definition),data:data(row)})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const exactConstraint=(rows:readonly ExtensionCatalogRow[],spec:ConstraintSpec)=>rows.some(row=>{const d=data(row),definition=catalogDefinition(row.definition);return row.kind==='constraint'&&row.schema_name===spec.schema&&row.object_name===spec.table&&row.name===spec.name&&d.type===spec.type&&d.validated===true&&(!spec.local||ordered(strings(d.localColumns),spec.local))&&(!spec.reference||(d.referenceSchema===spec.reference.schema&&d.referenceTable===spec.reference.table&&ordered(strings(d.referenceColumns),spec.reference.columns)))&&(!spec.definition||spec.definition(definition));});
const exactConstraintSet=(rows:readonly ExtensionCatalogRow[],schemas:readonly string[],specs:readonly ConstraintSpec[])=>rows.filter(row=>row.kind==='constraint'&&schemas.includes(row.schema_name)).length===specs.length&&specs.every(spec=>exactConstraint(rows,spec));
const exactIndex=(rows:readonly ExtensionCatalogRow[],schema:string,table:string,name:string,columns:readonly string[],parts:readonly string[]=[])=>rows.some(row=>{const d=data(row),definition=catalogSearch(row.definition);return row.kind==='index'&&row.schema_name===schema&&row.object_name===table&&row.name===name&&d.valid===true&&d.ready===true&&d.live===true&&ordered(strings(d.columns),columns)&&d.predicate===null&&parts.every(part=>definition.includes(part));});
const exactTrigger=(rows:readonly ExtensionCatalogRow[],spec:TriggerSpec)=>rows.some(row=>{const d=data(row),definition=catalogSearch(row.definition);return row.kind==='trigger'&&row.schema_name===spec.schema&&row.object_name===spec.table&&row.name===spec.name&&d.enabled!==undefined&&['O','A'].includes(String(d.enabled))&&d.internal===false&&d.functionIdentity===spec.fn&&spec.parts.every(part=>definition.includes(part));});
const exactFunction=(rows:readonly ExtensionCatalogRow[],schema:string,name:string,required:readonly string[],forbidden:readonly string[]=[]):boolean=>rows.some(row=>{const d=data(row),definition=catalogSearch(row.definition);return row.kind==='function'&&row.schema_name===schema&&row.object_name===name&&row.name===`${name}()`&&d.language==='plpgsql'&&d.securityDefiner===false&&d.volatility==='v'&&d.parallel==='u'&&d.leakproof===false&&required.every(part=>definition.includes(part))&&forbidden.every(part=>!definition.includes(part));});
const aclReady=(rows:readonly ExtensionCatalogRow[],schemas:readonly string[],publicFunction:string|null=null)=>rows.filter(row=>row.kind==='acl'&&schemas.includes(row.schema_name)).every(row=>{const d=data(row);return d.grantee==='OWNER'||(d.grantee==='PUBLIC'&&d.objectType==='function'&&`${row.schema_name}.${row.object_name}`===publicFunction&&d.privilege==='EXECUTE'&&d.grantable===false);});
const columnCatalogDigest=(rows:readonly ExtensionCatalogRow[],tables:ReadonlySet<string>)=>createHash('sha256').update(JSON.stringify(extensionFingerprint(rows.filter(row=>row.kind==='column'&&tables.has(`${row.schema_name}.${row.object_name}`))))).digest('hex');
const GROUP_TABLES=new Set(['ls_service_interest.inquiries','ls_service_interest.operations']);
const PROVIDER_TABLES=new Set(['ls_provider_index.entries','ls_provider_referrals.contexts','ls_provider_index.command_receipts','ls_provider_index.access_events']);
const AUDIENCE_TABLES=new Set(['ls_contact_ops.audience_profiles','ls_contact_ops.audience_interests','ls_contact_ops.audience_observations','ls_contact_ops.audience_operation_receipts']);
const GROUP_COLUMNS_SHA256='dd845c57eb58024211393f312499b3527fc11b12f35b027561ecd759261a9a1e';
const PROVIDER_COLUMNS_SHA256='5bf41415ba91d2ed5c2941e6cbd88a681b459f2a82aff1cb1357fc9513a0e6d7';
const AUDIENCE_COLUMNS_SHA256='a96627567cd26dc60e1d18a4edac38ae0283e279d2dbb450fd861b9ed366b37d';
const digestCheck=(column:string)=>(definition:string)=>strictConstraint(definition,0,[new RegExp(`${column}\\s*~\\s*'\\^\\[a-f0-9\\]\\{64\\}\\\\?\\$'`,'i')]);
const positiveLength=(definition:string)=>strictConstraint(definition,0,[/length\(payload_ciphertext\)\s*>\s*0/i]);
const boundedLength=(definition:string)=>strictConstraint(definition,0,[/length\(payload_ciphertext\)\s*>=\s*1/i,/length\(payload_ciphertext\)\s*<=\s*100000/i]);
const positive=(column:string,allowZero=false)=>(definition:string)=>strictConstraint(definition,0,[new RegExp(`${column}\\s*${allowZero?'>=':'>'}\\s*0`,'i')]);
const fixed=(column:string,value:string)=>(definition:string)=>strictConstraint(definition,0,[new RegExp(`${column}\\s*=\\s*'${value}'`,'i')])&&same(literals(definition),[value]);
const oneOf=(column:string,values:readonly string[])=>(definition:string)=>strictConstraint(definition,0,[new RegExp(`${column}\\s*(?:=\\s*any|in\\s*\\()`,'i')])&&same(literals(definition),values);

const GROUP_CONSTRAINTS:readonly ConstraintSpec[]=[
 {schema:'ls_service_interest',table:'inquiries',name:'inquiries_pkey',type:'p',local:['workspace_id','id']},
 {schema:'ls_service_interest',table:'inquiries',name:'inquiries_workspace_id_request_digest_key',type:'u',local:['workspace_id','request_digest']},
 {schema:'ls_service_interest',table:'inquiries',name:'inquiries_workspace_id_id_request_digest_key',type:'u',local:['workspace_id','id','request_digest']},
 {schema:'ls_service_interest',table:'inquiries',name:'inquiries_request_digest_check',type:'c',local:['request_digest'],definition:digestCheck('request_digest')},
 {schema:'ls_service_interest',table:'inquiries',name:'inquiries_payload_ciphertext_check',type:'c',local:['payload_ciphertext'],definition:positiveLength},
 {schema:'ls_service_interest',table:'inquiries',name:'inquiries_workspace_id_fkey',type:'f',local:['workspace_id'],reference:{schema:'ls_identity',table:'workspaces',columns:['id']}},
 {schema:'ls_service_interest',table:'inquiries',name:'inquiries_workspace_id_recorded_by_fkey',type:'f',local:['workspace_id','recorded_by'],reference:{schema:'ls_identity',table:'accounts',columns:['workspace_id','id']}},
 {schema:'ls_service_interest',table:'operations',name:'operations_pkey',type:'p',local:['workspace_id','operation_id']},
 {schema:'ls_service_interest',table:'operations',name:'operations_request_digest_check',type:'c',local:['request_digest'],definition:digestCheck('request_digest')},
 {schema:'ls_service_interest',table:'operations',name:'operations_workspace_id_inquiry_id_request_digest_fkey',type:'f',local:['workspace_id','inquiry_id','request_digest'],reference:{schema:'ls_service_interest',table:'inquiries',columns:['workspace_id','id','request_digest']}},
 {schema:'ls_service_interest',table:'operations',name:'operations_workspace_id_recorded_by_fkey',type:'f',local:['workspace_id','recorded_by'],reference:{schema:'ls_identity',table:'accounts',columns:['workspace_id','id']}},
];
const PROVIDER_CONSTRAINTS:readonly ConstraintSpec[]=[
 {schema:'ls_provider_index',table:'entries',name:'entries_pkey',type:'p',local:['workspace_id','id']},{schema:'ls_provider_index',table:'entries',name:'entries_workspace_id_owner_account_id_id_key',type:'u',local:['workspace_id','owner_account_id','id']},{schema:'ls_provider_index',table:'entries',name:'entries_payload_ciphertext_check',type:'c',local:['payload_ciphertext'],definition:boundedLength},{schema:'ls_provider_index',table:'entries',name:'entries_version_check',type:'c',local:['version'],definition:positive('version')},{schema:'ls_provider_index',table:'entries',name:'entries_workspace_id_owner_account_id_fkey',type:'f',local:['workspace_id','owner_account_id'],reference:{schema:'ls_identity',table:'accounts',columns:['workspace_id','id']}},
 {schema:'ls_cases',table:'cases',name:'ls_cases_provider_referral_owner',type:'u',local:['workspace_id','id','practitioner_account_id']},
 {schema:'ls_provider_referrals',table:'contexts',name:'contexts_pkey',type:'p',local:['workspace_id','id']},{schema:'ls_provider_referrals',table:'contexts',name:'contexts_payload_ciphertext_check',type:'c',local:['payload_ciphertext'],definition:boundedLength},{schema:'ls_provider_referrals',table:'contexts',name:'contexts_version_check',type:'c',local:['version'],definition:positive('version')},{schema:'ls_provider_referrals',table:'contexts',name:'contexts_workspace_id_owner_account_id_provider_id_fkey',type:'f',local:['workspace_id','owner_account_id','provider_id'],reference:{schema:'ls_provider_index',table:'entries',columns:['workspace_id','owner_account_id','id']}},{schema:'ls_provider_referrals',table:'contexts',name:'contexts_workspace_id_case_id_owner_account_id_fkey',type:'f',local:['workspace_id','case_id','owner_account_id'],reference:{schema:'ls_cases',table:'cases',columns:['workspace_id','id','practitioner_account_id']}},
 {schema:'ls_provider_index',table:'command_receipts',name:'command_receipts_pkey',type:'p',local:['workspace_id','owner_account_id','operation_id']},{schema:'ls_provider_index',table:'command_receipts',name:'command_receipts_kind_check',type:'c',local:['kind'],definition:oneOf('kind',['provider_create','provider_update','provider_archive','referral_create','referral_update'])},{schema:'ls_provider_index',table:'command_receipts',name:'command_receipts_payload_digest_check',type:'c',local:['payload_digest'],definition:digestCheck('payload_digest')},{schema:'ls_provider_index',table:'command_receipts',name:'command_receipts_result_version_check',type:'c',local:['result_version'],definition:positive('result_version')},{schema:'ls_provider_index',table:'command_receipts',name:'command_receipts_workspace_id_owner_account_id_fkey',type:'f',local:['workspace_id','owner_account_id'],reference:{schema:'ls_identity',table:'accounts',columns:['workspace_id','id']}},
 {schema:'ls_provider_index',table:'access_events',name:'access_events_pkey',type:'p',local:['id']},{schema:'ls_provider_index',table:'access_events',name:'access_events_action_check',type:'c',local:['action'],definition:oneOf('action',['directory_read','provider_read','provider_create','provider_update','provider_archive','referral_read','referral_create','referral_update'])},{schema:'ls_provider_index',table:'access_events',name:'access_events_workspace_id_owner_account_id_fkey',type:'f',local:['workspace_id','owner_account_id'],reference:{schema:'ls_identity',table:'accounts',columns:['workspace_id','id']}},
];
const AUDIENCE_CONSTRAINTS:readonly ConstraintSpec[]=[
 {schema:'ls_contact_ops',table:'audience_profiles',name:'audience_profiles_pkey',type:'p',local:['workspace_id','person_id']},{schema:'ls_contact_ops',table:'audience_profiles',name:'audience_profiles_payload_ciphertext_check',type:'c',local:['payload_ciphertext'],definition:positiveLength},{schema:'ls_contact_ops',table:'audience_profiles',name:'audience_profiles_record_mode_check',type:'c',local:['record_mode'],definition:fixed('record_mode','live')},{schema:'ls_contact_ops',table:'audience_profiles',name:'audience_profiles_workspace_id_person_id_fkey',type:'f',local:['workspace_id','person_id'],reference:{schema:'ls_identity',table:'people',columns:['workspace_id','id']}},
 {schema:'ls_contact_ops',table:'audience_interests',name:'audience_interests_pkey',type:'p',local:['workspace_id','person_id','topic']},{schema:'ls_contact_ops',table:'audience_interests',name:'audience_interests_topic_check',type:'c',local:['topic'],definition:fixed('topic','bna_content')},{schema:'ls_contact_ops',table:'audience_interests',name:'audience_interests_payload_ciphertext_check',type:'c',local:['payload_ciphertext'],definition:positiveLength},{schema:'ls_contact_ops',table:'audience_interests',name:'audience_interests_version_check',type:'c',local:['version'],definition:positive('version')},{schema:'ls_contact_ops',table:'audience_interests',name:'audience_interests_workspace_id_person_id_fkey',type:'f',local:['workspace_id','person_id'],reference:{schema:'ls_contact_ops',table:'audience_profiles',columns:['workspace_id','person_id']}},{schema:'ls_contact_ops',table:'audience_interests',name:'audience_interests_workspace_id_actor_account_id_fkey',type:'f',local:['workspace_id','actor_account_id'],reference:{schema:'ls_identity',table:'accounts',columns:['workspace_id','id']}},
 {schema:'ls_contact_ops',table:'audience_observations',name:'audience_observations_pkey',type:'p',local:['workspace_id','observation_id']},{schema:'ls_contact_ops',table:'audience_observations',name:'audience_observations_workspace_id_person_id_topic_source_d_key',type:'u',local:['workspace_id','person_id','topic','source_digest']},{schema:'ls_contact_ops',table:'audience_observations',name:'audience_observations_topic_check',type:'c',local:['topic'],definition:fixed('topic','bna_content')},{schema:'ls_contact_ops',table:'audience_observations',name:'audience_observations_source_digest_check',type:'c',local:['source_digest'],definition:digestCheck('source_digest')},{schema:'ls_contact_ops',table:'audience_observations',name:'audience_observations_payload_ciphertext_check',type:'c',local:['payload_ciphertext'],definition:positiveLength},{schema:'ls_contact_ops',table:'audience_observations',name:'audience_observations_workspace_id_person_id_fkey',type:'f',local:['workspace_id','person_id'],reference:{schema:'ls_contact_ops',table:'audience_profiles',columns:['workspace_id','person_id']}},{schema:'ls_contact_ops',table:'audience_observations',name:'audience_observations_workspace_id_actor_account_id_fkey',type:'f',local:['workspace_id','actor_account_id'],reference:{schema:'ls_identity',table:'accounts',columns:['workspace_id','id']}},
 {schema:'ls_contact_ops',table:'audience_operation_receipts',name:'audience_operation_receipts_pkey',type:'p',local:['workspace_id','operation_id']},{schema:'ls_contact_ops',table:'audience_operation_receipts',name:'audience_operation_receipts_payload_digest_check',type:'c',local:['payload_digest'],definition:digestCheck('payload_digest')},{schema:'ls_contact_ops',table:'audience_operation_receipts',name:'audience_operation_receipts_result_version_check',type:'c',local:['result_version'],definition:positive('result_version',true)},{schema:'ls_contact_ops',table:'audience_operation_receipts',name:'audience_operation_receipts_workspace_id_person_id_fkey',type:'f',local:['workspace_id','person_id'],reference:{schema:'ls_contact_ops',table:'audience_profiles',columns:['workspace_id','person_id']}},{schema:'ls_contact_ops',table:'audience_operation_receipts',name:'audience_operation_receipts_workspace_id_actor_account_id_fkey',type:'f',local:['workspace_id','actor_account_id'],reference:{schema:'ls_identity',table:'accounts',columns:['workspace_id','id']}},
];

export function classifyContactWork(snapshot:ContactWorkSnapshot):ContactWorkStage{
 const workflow=snapshot.workflowColumns&&snapshot.workflowConstraints&&snapshot.effectiveDueIndex&&snapshot.taskHistoryImmutable&&snapshot.taskPermissions&&snapshot.taskColumns===26&&snapshot.taskConstraints===16;
 const baseline=!snapshot.workflowColumns&&!snapshot.workflowConstraints&&!snapshot.effectiveDueIndex&&snapshot.taskHistoryImmutable&&snapshot.taskPermissions&&snapshot.taskColumns===23&&snapshot.taskConstraints===14;
 const source=same(snapshot.sourceKinds,sourceStages[0])?0:same(snapshot.sourceKinds,sourceStages[1])?1:same(snapshot.sourceKinds,sourceStages[2])?2:-1;
 const constraints=snapshot.sourceConstraintStrict&&snapshot.stateConstraintStrict&&snapshot.historyConstraintStrict;
 const baseState=constraints&&same(snapshot.stateKinds,['open','done'])&&same(snapshot.historyActions,['created','completed','source_updated','source_resolved']);
 const managedState=constraints&&same(snapshot.stateKinds,['open','in_progress','done'])&&same(snapshot.historyActions,['created','completed','source_updated','source_resolved','managed']);
 const call=snapshot.callLinksSchema&&snapshot.callLinksForeignKeys&&snapshot.callLinksImmutable&&snapshot.callLinksPermissions&&snapshot.callLinksReferencesSound;
 const lead=snapshot.leadCommandsSchema&&snapshot.leadCommandsForeignKeys&&snapshot.leadCommandsImmutable&&snapshot.leadCommandsPermissions&&snapshot.leadCommandsReferencesSound;
 const extensionsAbsent=snapshot.groupInterestAbsent&&snapshot.providerIndexAbsent&&snapshot.audienceInterestAbsent;
 if(baseline&&source===0&&baseState&&snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent&&extensionsAbsent)return 0;
 if(baseline&&source===1&&baseState&&snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent&&extensionsAbsent)return 1;
 if(workflow&&source===1&&managedState&&snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent&&extensionsAbsent)return 2;
 if(workflow&&source===2&&managedState&&snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent&&extensionsAbsent)return 3;
 if(workflow&&source===2&&managedState&&call&&!snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent&&extensionsAbsent)return 4;
 const stage5=workflow&&source===2&&managedState&&call&&!snapshot.callLinksAbsent&&lead&&!snapshot.leadCommandsAbsent;
 if(stage5&&snapshot.groupInterestAbsent&&snapshot.providerIndexAbsent&&snapshot.audienceInterestAbsent)return 5;
 if(stage5&&snapshot.groupInterestReady&&!snapshot.groupInterestAbsent&&snapshot.providerIndexAbsent&&snapshot.audienceInterestAbsent)return 6;
 if(stage5&&snapshot.groupInterestReady&&!snapshot.groupInterestAbsent&&snapshot.providerIndexReady&&!snapshot.providerIndexAbsent&&snapshot.audienceInterestAbsent)return 7;
 if(stage5&&snapshot.groupInterestReady&&!snapshot.groupInterestAbsent&&snapshot.providerIndexReady&&!snapshot.providerIndexAbsent&&snapshot.audienceInterestReady&&!snapshot.audienceInterestAbsent)return 8;
 throw new Error('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
}

export function contactWorkPlan(files:readonly Migration[],history:readonly AppliedMigration[],snapshot:ContactWorkSnapshot):{stage:ContactWorkStage;pending:readonly Migration[]} {
 const baseline=files.findIndex(file=>file.name===CONTACT_WORK_BASELINE.name&&file.checksum===CONTACT_WORK_BASELINE.sha256);
 if(baseline<0)throw new Error('CONTACT_WORK_BASELINE_MISSING');
 const suffix=files.slice(baseline+1);
 if(suffix.length!==CONTACT_WORK_MIGRATIONS.length||suffix.some((file,index)=>file.name!==CONTACT_WORK_MIGRATIONS[index]?.name||file.checksum!==CONTACT_WORK_MIGRATIONS[index]?.sha256))throw new Error('CONTACT_WORK_MIGRATION_SET_MISMATCH');
 const pending=planMigrations(files,history),stage=classifyContactWork(snapshot);
 const applied=history.length-(baseline+1);
 if(applied!==stage||pending.length!==CONTACT_WORK_MIGRATIONS.length-stage||pending.some((file,index)=>file.name!==CONTACT_WORK_MIGRATIONS[stage+index]?.name))throw new Error('CONTACT_WORK_LEDGER_STATE_CONFLICT');
 return {stage,pending};
}

export async function readContactWorkSnapshot(db:ContactWorkQuery):Promise<ContactWorkSnapshot>{
 const task=await db.query<{columns:string[];constraints:number;source:string|null;state:string|null;actions:string|null;workflow:boolean;effective:boolean;immutable:boolean;permissions:boolean}>(`SELECT
  (SELECT array_agg(c.relname||'.'||a.attname ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history') AND a.attnum>0 AND NOT a.attisdropped) AS columns,
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history') AND k.contype<>'n') AS constraints,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.tasks') AND conname='tasks_source_tuple_check') AS source,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.tasks') AND conname='tasks_state_check') AS state,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.task_history') AND conname='task_history_action_check') AS actions,
  EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('ls_calendar.tasks') AND attname='snoozed_until' AND atttypid='date'::regtype AND NOT attnotnull AND NOT attisdropped)
   AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('ls_calendar.task_history') AND attname='state_value' AND atttypid='text'::regtype AND NOT attnotnull AND NOT attisdropped)
   AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('ls_calendar.task_history') AND attname='snoozed_until' AND atttypid='date'::regtype AND NOT attnotnull AND NOT attisdropped) AS workflow,
  EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('ls_calendar.tasks_by_effective_due') AND indisvalid AND indisready AND indislive) AS effective,
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('ls_calendar.task_history') AND tgname='task_history_immutable' AND NOT tgisinternal AND tgenabled IN ('O','A') AND tgfoid=to_regprocedure('ls_calendar.append_only()')) AS immutable,
  NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history') AND acl.grantee<>c.relowner) AS permissions`);
 const tables=await db.query<{call_absent:boolean;call_schema:boolean;call_fks:boolean;call_immutable:boolean;call_permissions:boolean;call_refs:boolean;lead_absent:boolean;lead_schema:boolean;lead_fks:boolean;lead_immutable:boolean;lead_permissions:boolean;lead_refs:boolean}>(`SELECT
  to_regclass('ls_contact_ops.call_activity_links') IS NULL AS call_absent,
  (SELECT count(*)=4 FROM pg_attribute WHERE attrelid=to_regclass('ls_contact_ops.call_activity_links') AND attnum>0 AND NOT attisdropped) AND (SELECT count(*)=3 FROM pg_constraint WHERE conrelid=to_regclass('ls_contact_ops.call_activity_links') AND contype<>'n') AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('ls_contact_ops.call_activity_by_person') AND indisvalid AND indisready AND indislive) AS call_schema,
  (SELECT count(*)=2 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid=to_regclass('ls_contact_ops.call_activity_links') AND contype='f') AS call_fks,
  (SELECT count(*)=2 AND bool_and(tgfoid=to_regprocedure('ls_contact_ops.deny_acquisition_receipt_mutation()') AND tgenabled IN ('O','A')) FROM pg_trigger WHERE tgrelid=to_regclass('ls_contact_ops.call_activity_links') AND NOT tgisinternal) AS call_immutable,
  NOT EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid=to_regclass('ls_contact_ops.call_activity_links') AND acl.grantee<>c.relowner) AS call_permissions,
  (SELECT count(*)=2
    AND bool_or(ref_schema='ls_contact_ops' AND ref_table='inbound_activity_candidates' AND local_cols=ARRAY['workspace_id','candidate_id']::text[] AND ref_cols=ARRAY['workspace_id','id']::text[])
    AND bool_or(ref_schema='ls_identity' AND ref_table='people' AND local_cols=ARRAY['workspace_id','person_id']::text[] AND ref_cols=ARRAY['workspace_id','id']::text[])
   FROM (SELECT rn.nspname AS ref_schema,rc.relname AS ref_table,
    ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS local_cols,
    ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord) AS ref_cols
    FROM pg_constraint k JOIN pg_class rc ON rc.oid=k.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
    WHERE k.conrelid=to_regclass('ls_contact_ops.call_activity_links') AND k.contype='f' AND k.convalidated) refs) AS call_refs,
  to_regclass('ls_contact_ops.lead_commands') IS NULL AS lead_absent,
  (SELECT count(*)=8 FROM pg_attribute WHERE attrelid=to_regclass('ls_contact_ops.lead_commands') AND attnum>0 AND NOT attisdropped) AND (SELECT count(*)=6 FROM pg_constraint WHERE conrelid=to_regclass('ls_contact_ops.lead_commands') AND contype<>'n') AS lead_schema,
  (SELECT count(*)=2 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid=to_regclass('ls_contact_ops.lead_commands') AND contype='f') AS lead_fks,
  (SELECT count(*)=2 AND bool_and(tgfoid=to_regprocedure('ls_contact_ops.deny_acquisition_receipt_mutation()') AND tgenabled IN ('O','A')) FROM pg_trigger WHERE tgrelid=to_regclass('ls_contact_ops.lead_commands') AND NOT tgisinternal) AS lead_immutable,
  NOT EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid=to_regclass('ls_contact_ops.lead_commands') AND acl.grantee<>c.relowner) AS lead_permissions,
  (SELECT count(*)=2
    AND bool_or(ref_schema='ls_identity' AND ref_table='accounts' AND local_cols=ARRAY['workspace_id','actor_account_id']::text[] AND ref_cols=ARRAY['workspace_id','id']::text[])
    AND bool_or(ref_schema='ls_contact_ops' AND ref_table='profiles' AND local_cols=ARRAY['workspace_id','person_id']::text[] AND ref_cols=ARRAY['workspace_id','person_id']::text[])
   FROM (SELECT rn.nspname AS ref_schema,rc.relname AS ref_table,
    ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS local_cols,
    ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord) AS ref_cols
    FROM pg_constraint k JOIN pg_class rc ON rc.oid=k.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
    WHERE k.conrelid=to_regclass('ls_contact_ops.lead_commands') AND k.contype='f' AND k.convalidated) refs) AS lead_refs`);
 const extensions=await db.query<{group_absent:boolean;group_ready:boolean;provider_absent:boolean;provider_ready:boolean;audience_absent:boolean;audience_ready:boolean}>(`SELECT
  to_regnamespace('ls_service_interest') IS NULL
   AND to_regclass('ls_service_interest.inquiries') IS NULL
   AND to_regclass('ls_service_interest.operations') IS NULL AS group_absent,
  to_regclass('ls_service_interest.inquiries') IS NOT NULL
   AND to_regclass('ls_service_interest.operations') IS NOT NULL
   AND (SELECT count(*)=12 FROM pg_attribute WHERE attrelid IN (to_regclass('ls_service_interest.inquiries'),to_regclass('ls_service_interest.operations')) AND attnum>0 AND NOT attisdropped)
   AND (SELECT count(*)=4 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid IN (to_regclass('ls_service_interest.inquiries'),to_regclass('ls_service_interest.operations')) AND contype='f')
   AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('ls_service_interest.group_interest_recent') AND indisvalid AND indisready AND indislive)
   AND NOT EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid IN (to_regclass('ls_service_interest.inquiries'),to_regclass('ls_service_interest.operations')) AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname='ls_service_interest' AND acl.grantee=0) AS group_ready,
  to_regnamespace('ls_provider_index') IS NULL
   AND to_regnamespace('ls_provider_referrals') IS NULL
   AND to_regclass('ls_provider_index.entries') IS NULL
   AND to_regclass('ls_provider_referrals.contexts') IS NULL
   AND to_regclass('ls_provider_index.command_receipts') IS NULL
   AND to_regclass('ls_provider_index.access_events') IS NULL AS provider_absent,
  to_regclass('ls_provider_index.entries') IS NOT NULL
   AND to_regclass('ls_provider_referrals.contexts') IS NOT NULL
   AND to_regclass('ls_provider_index.command_receipts') IS NOT NULL
   AND to_regclass('ls_provider_index.access_events') IS NOT NULL
   AND (SELECT count(*)=32 FROM pg_attribute WHERE attrelid IN (to_regclass('ls_provider_index.entries'),to_regclass('ls_provider_referrals.contexts'),to_regclass('ls_provider_index.command_receipts'),to_regclass('ls_provider_index.access_events')) AND attnum>0 AND NOT attisdropped)
   AND (SELECT count(*)=5 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid IN (to_regclass('ls_provider_index.entries'),to_regclass('ls_provider_referrals.contexts'),to_regclass('ls_provider_index.command_receipts'),to_regclass('ls_provider_index.access_events')) AND contype='f')
   AND to_regprocedure('ls_provider_index.deny_entry_scope_mutation()') IS NOT NULL
   AND to_regprocedure('ls_provider_referrals.deny_scope_mutation()') IS NOT NULL
   AND to_regprocedure('ls_provider_index.deny_history_mutation()') IS NOT NULL
   AND (SELECT count(*)=6 AND bool_and(tgenabled IN ('O','A')) FROM pg_trigger WHERE tgrelid IN (to_regclass('ls_provider_index.entries'),to_regclass('ls_provider_referrals.contexts'),to_regclass('ls_provider_index.command_receipts'),to_regclass('ls_provider_index.access_events')) AND NOT tgisinternal)
   AND NOT EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid IN (to_regclass('ls_provider_index.entries'),to_regclass('ls_provider_referrals.contexts'),to_regclass('ls_provider_index.command_receipts'),to_regclass('ls_provider_index.access_events')) AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname IN ('ls_provider_index','ls_provider_referrals') AND acl.grantee=0) AS provider_ready,
  to_regclass('ls_contact_ops.audience_profiles') IS NULL
   AND to_regclass('ls_contact_ops.audience_interests') IS NULL
   AND to_regclass('ls_contact_ops.audience_observations') IS NULL
   AND to_regclass('ls_contact_ops.audience_operation_receipts') IS NULL
   AND to_regprocedure('ls_contact_ops.reject_audience_ledger_mutation()') IS NULL AS audience_absent,
  to_regclass('ls_contact_ops.audience_profiles') IS NOT NULL
   AND to_regclass('ls_contact_ops.audience_interests') IS NOT NULL
   AND to_regclass('ls_contact_ops.audience_observations') IS NOT NULL
   AND to_regclass('ls_contact_ops.audience_operation_receipts') IS NOT NULL
   AND (SELECT count(*)=30 FROM pg_attribute WHERE attrelid IN (to_regclass('ls_contact_ops.audience_profiles'),to_regclass('ls_contact_ops.audience_interests'),to_regclass('ls_contact_ops.audience_observations'),to_regclass('ls_contact_ops.audience_operation_receipts')) AND attnum>0 AND NOT attisdropped)
   AND (SELECT count(*)=7 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid IN (to_regclass('ls_contact_ops.audience_profiles'),to_regclass('ls_contact_ops.audience_interests'),to_regclass('ls_contact_ops.audience_observations'),to_regclass('ls_contact_ops.audience_operation_receipts')) AND contype='f')
   AND to_regprocedure('ls_contact_ops.reject_audience_ledger_mutation()') IS NOT NULL
   AND (SELECT count(*)=2 AND bool_and(tgfoid=to_regprocedure('ls_contact_ops.reject_audience_ledger_mutation()') AND tgenabled IN ('O','A')) FROM pg_trigger WHERE tgrelid IN (to_regclass('ls_contact_ops.audience_observations'),to_regclass('ls_contact_ops.audience_operation_receipts')) AND NOT tgisinternal)
   AND NOT EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid IN (to_regclass('ls_contact_ops.audience_profiles'),to_regclass('ls_contact_ops.audience_interests'),to_regclass('ls_contact_ops.audience_observations'),to_regclass('ls_contact_ops.audience_operation_receipts')) AND acl.grantee<>c.relowner) AS audience_ready`);
 const catalog=await db.query<ExtensionCatalogRow>(`WITH relevant_tables(oid) AS (VALUES
   (to_regclass('ls_service_interest.inquiries')),(to_regclass('ls_service_interest.operations')),
   (to_regclass('ls_provider_index.entries')),(to_regclass('ls_provider_referrals.contexts')),
   (to_regclass('ls_provider_index.command_receipts')),(to_regclass('ls_provider_index.access_events')),
   (to_regclass('ls_contact_ops.audience_profiles')),(to_regclass('ls_contact_ops.audience_interests')),
   (to_regclass('ls_contact_ops.audience_observations')),(to_regclass('ls_contact_ops.audience_operation_receipts'))
 ), catalog AS (
  SELECT 'column'::text AS kind,n.nspname AS schema_name,c.relname AS object_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS definition,
   jsonb_build_object('position',a.attnum,'dataType',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'defaultExpression',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) AS data
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid IN (SELECT oid FROM relevant_tables WHERE oid IS NOT NULL) AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint',n.nspname AS schema_name,c.relname AS object_name,k.conname AS name,pg_get_constraintdef(k.oid,true) AS definition,
   jsonb_build_object('type',k.contype,'validated',k.convalidated,
    'localColumns',ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord),
    'referenceSchema',rn.nspname,'referenceTable',rc.relname,
    'referenceColumns',ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord)) AS data
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   LEFT JOIN pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
  WHERE k.contype<>'n' AND (k.conrelid IN (SELECT oid FROM relevant_tables WHERE oid IS NOT NULL) OR (k.conrelid=to_regclass('ls_cases.cases') AND k.conname='ls_cases_provider_referral_owner'))
  UNION ALL
  SELECT 'index',n.nspname,c.relname,ic.relname,pg_get_indexdef(i.indexrelid),jsonb_build_object('valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
   'columns',ARRAY(SELECT pg_get_indexdef(i.indexrelid,x,true) FROM generate_series(1,i.indnkeyatts) x ORDER BY x),'predicate',pg_get_expr(i.indpred,i.indrelid))
  FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace n ON n.oid=ic.relnamespace JOIN pg_class c ON c.oid=i.indrelid
  WHERE ic.oid IN (to_regclass('ls_service_interest.group_interest_recent'),to_regclass('ls_provider_index.provider_entries_owner'),to_regclass('ls_provider_referrals.provider_referrals_case'),to_regclass('ls_provider_referrals.provider_referrals_provider'),to_regclass('ls_provider_index.provider_access_owner'))
  UNION ALL
  SELECT 'trigger',n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid,true),jsonb_build_object('enabled',t.tgenabled,'internal',t.tgisinternal,'functionIdentity',pn.nspname||'.'||p.proname||'()')
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
  WHERE NOT t.tgisinternal AND t.tgrelid IN (SELECT oid FROM relevant_tables WHERE oid IS NOT NULL)
  UNION ALL
  SELECT 'function',n.nspname,p.proname,p.proname||'()',pg_get_functiondef(p.oid),jsonb_build_object('language',l.lanname,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'leakproof',p.proleakproof)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE p.pronargs=0 AND (n.nspname,p.proname) IN (('ls_provider_index','deny_entry_scope_mutation'),('ls_provider_index','deny_history_mutation'),('ls_provider_referrals','deny_scope_mutation'),('ls_contact_ops','reject_audience_ledger_mutation'))
  UNION ALL
  SELECT 'acl',n.nspname,c.relname,acl.privilege_type||':'||CASE WHEN acl.grantee=c.relowner THEN 'OWNER' WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
   'table:'||CASE WHEN acl.grantee=c.relowner THEN 'OWNER' WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END||':'||acl.privilege_type||':'||acl.is_grantable,
   jsonb_build_object('objectType','table','grantee',CASE WHEN acl.grantee=c.relowner THEN 'OWNER' WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,'privilege',acl.privilege_type,'grantable',acl.is_grantable)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
  WHERE c.oid IN (SELECT oid FROM relevant_tables WHERE oid IS NOT NULL)
  UNION ALL
  SELECT 'acl',n.nspname,n.nspname,acl.privilege_type||':'||CASE WHEN acl.grantee=n.nspowner THEN 'OWNER' WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
   'schema:'||CASE WHEN acl.grantee=n.nspowner THEN 'OWNER' WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END||':'||acl.privilege_type||':'||acl.is_grantable,
   jsonb_build_object('objectType','schema','grantee',CASE WHEN acl.grantee=n.nspowner THEN 'OWNER' WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,'privilege',acl.privilege_type,'grantable',acl.is_grantable)
  FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
  WHERE n.nspname IN ('ls_service_interest','ls_provider_index','ls_provider_referrals')
  UNION ALL
  SELECT 'acl',n.nspname,p.proname,p.proname||'():'||acl.privilege_type||':'||CASE WHEN acl.grantee=p.proowner THEN 'OWNER' WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
   'function:'||CASE WHEN acl.grantee=p.proowner THEN 'OWNER' WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END||':'||acl.privilege_type||':'||acl.is_grantable,
   jsonb_build_object('objectType','function','grantee',CASE WHEN acl.grantee=p.proowner THEN 'OWNER' WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,'privilege',acl.privilege_type,'grantable',acl.is_grantable)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  WHERE p.pronargs=0 AND (n.nspname,p.proname) IN (('ls_provider_index','deny_entry_scope_mutation'),('ls_provider_index','deny_history_mutation'),('ls_provider_referrals','deny_scope_mutation'),('ls_contact_ops','reject_audience_ledger_mutation'))
 ) SELECT kind,schema_name,object_name,name,definition,data FROM catalog ORDER BY kind,schema_name,object_name,name,definition`);
 const row=task.rows[0]!,objects=tables.rows[0]!,extension=extensions.rows[0]!,catalogRows=catalog.rows;
 const workflow=row.workflow?await db.query<{snooze:string|null;history:string|null}>(`SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.tasks') AND conname='tasks_snooze_check' AND convalidated) AS snooze,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.task_history') AND conname='task_history_state_check' AND convalidated) AS history`):{rows:[{snooze:null,history:null}]};
 const definitions=[row.source,row.state,row.actions,workflow.rows[0]?.snooze??null,workflow.rows[0]?.history??null].map(normalizedConstraint),constraintDigest=createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
 const groupColumns=columnCatalogDigest(catalogRows,GROUP_TABLES),providerColumns=columnCatalogDigest(catalogRows,PROVIDER_TABLES),audienceColumns=columnCatalogDigest(catalogRows,AUDIENCE_TABLES);
 const groupSemantic=groupColumns===GROUP_COLUMNS_SHA256&&exactConstraintSet(catalogRows,['ls_service_interest'],GROUP_CONSTRAINTS)&&exactIndex(catalogRows,'ls_service_interest','inquiries','group_interest_recent',['workspace_id','created_at','id'],['(workspace_id, created_at desc, id desc)'])&&catalogRows.filter(item=>item.kind==='trigger'&&item.schema_name==='ls_service_interest').length===0&&catalogRows.filter(item=>item.kind==='function'&&item.schema_name==='ls_service_interest').length===0&&aclReady(catalogRows,['ls_service_interest']);
 const providerTriggers:readonly TriggerSpec[]=[
  {schema:'ls_provider_index',table:'entries',name:'provider_entry_scope_no_edit',fn:'ls_provider_index.deny_entry_scope_mutation()',parts:['before update on ls_provider_index.entries','for each row execute function ls_provider_index.deny_entry_scope_mutation()']},
  {schema:'ls_provider_referrals',table:'contexts',name:'provider_referral_scope_no_edit',fn:'ls_provider_referrals.deny_scope_mutation()',parts:['before update on ls_provider_referrals.contexts','for each row execute function ls_provider_referrals.deny_scope_mutation()']},
  {schema:'ls_provider_index',table:'command_receipts',name:'provider_receipts_no_edit',fn:'ls_provider_index.deny_history_mutation()',parts:['before delete or update on ls_provider_index.command_receipts','for each row execute function ls_provider_index.deny_history_mutation()']},
  {schema:'ls_provider_index',table:'command_receipts',name:'provider_receipts_no_truncate',fn:'ls_provider_index.deny_history_mutation()',parts:['before truncate on ls_provider_index.command_receipts','for each statement execute function ls_provider_index.deny_history_mutation()']},
  {schema:'ls_provider_index',table:'access_events',name:'provider_access_no_edit',fn:'ls_provider_index.deny_history_mutation()',parts:['before delete or update on ls_provider_index.access_events','for each row execute function ls_provider_index.deny_history_mutation()']},
  {schema:'ls_provider_index',table:'access_events',name:'provider_access_no_truncate',fn:'ls_provider_index.deny_history_mutation()',parts:['before truncate on ls_provider_index.access_events','for each statement execute function ls_provider_index.deny_history_mutation()']},
 ];
 const providerFunctions=exactFunction(catalogRows,'ls_provider_index','deny_entry_scope_mutation',['old.workspace_id is distinct from new.workspace_id','old.id is distinct from new.id','old.owner_account_id is distinct from new.owner_account_id',"raise exception 'provider_entry_scope_immutable'",'return new'])&&exactFunction(catalogRows,'ls_provider_referrals','deny_scope_mutation',['old.workspace_id is distinct from new.workspace_id','old.id is distinct from new.id','old.owner_account_id is distinct from new.owner_account_id','old.provider_id is distinct from new.provider_id','old.case_id is distinct from new.case_id',"raise exception 'provider_referral_scope_immutable'",'return new'])&&exactFunction(catalogRows,'ls_provider_index','deny_history_mutation',["raise exception 'provider_history_immutable'"],['return new','return old']);
 const providerSemantic=providerColumns===PROVIDER_COLUMNS_SHA256&&exactConstraintSet(catalogRows,['ls_provider_index','ls_provider_referrals','ls_cases'],PROVIDER_CONSTRAINTS)&&exactIndex(catalogRows,'ls_provider_index','entries','provider_entries_owner',['workspace_id','owner_account_id','id'])&&exactIndex(catalogRows,'ls_provider_referrals','contexts','provider_referrals_case',['workspace_id','owner_account_id','case_id','created_at'])&&exactIndex(catalogRows,'ls_provider_referrals','contexts','provider_referrals_provider',['workspace_id','owner_account_id','provider_id','created_at'])&&exactIndex(catalogRows,'ls_provider_index','access_events','provider_access_owner',['workspace_id','owner_account_id','occurred_at'])&&catalogRows.filter(item=>item.kind==='trigger'&&['ls_provider_index','ls_provider_referrals'].includes(item.schema_name)).length===providerTriggers.length&&providerTriggers.every(spec=>exactTrigger(catalogRows,spec))&&providerFunctions&&aclReady(catalogRows,['ls_provider_index','ls_provider_referrals']);
 const audienceTriggers:readonly TriggerSpec[]=[
  {schema:'ls_contact_ops',table:'audience_observations',name:'audience_observations_append_only',fn:'ls_contact_ops.reject_audience_ledger_mutation()',parts:['before delete or update on ls_contact_ops.audience_observations','for each row execute function ls_contact_ops.reject_audience_ledger_mutation()']},
  {schema:'ls_contact_ops',table:'audience_operation_receipts',name:'audience_operation_receipts_append_only',fn:'ls_contact_ops.reject_audience_ledger_mutation()',parts:['before delete or update on ls_contact_ops.audience_operation_receipts','for each row execute function ls_contact_ops.reject_audience_ledger_mutation()']},
 ];
 const audienceTables=new Set(['audience_profiles','audience_interests','audience_observations','audience_operation_receipts']);
 const audienceCatalog=catalogRows.filter(item=>item.schema_name==='ls_contact_ops'&&(item.object_name==='reject_audience_ledger_mutation'||audienceTables.has(item.object_name)));
 const audienceSemantic=audienceColumns===AUDIENCE_COLUMNS_SHA256&&exactConstraintSet(audienceCatalog,['ls_contact_ops'],AUDIENCE_CONSTRAINTS)&&audienceCatalog.filter(item=>item.kind==='trigger').length===audienceTriggers.length&&audienceTriggers.every(spec=>exactTrigger(audienceCatalog,spec))&&exactFunction(audienceCatalog,'ls_contact_ops','reject_audience_ledger_mutation',["raise exception 'audience_ledger_append_only'"],['return new','return old'])&&aclReady(audienceCatalog,['ls_contact_ops'],'ls_contact_ops.reject_audience_ledger_mutation');
 const extensionDigest=createHash('sha256').update(JSON.stringify(extensionFingerprint(catalogRows))).digest('hex');
 return {taskColumns:row.columns?.length??0,taskConstraints:Number(row.constraints),sourceKinds:literals(row.source,sourceIgnored),stateKinds:literals(row.state),historyActions:literals(row.actions),sourceConstraintStrict:sourceStrict(row.source),stateConstraintStrict:stateStrict(row.state),historyConstraintStrict:historyStrict(row.actions),constraintDigest,workflowColumns:row.workflow===true,workflowConstraints:row.workflow===true&&snoozeStrict(workflow.rows[0]?.snooze)&&historyStateStrict(workflow.rows[0]?.history),effectiveDueIndex:row.effective===true,taskHistoryImmutable:row.immutable===true,taskPermissions:row.permissions===true,callLinksAbsent:objects.call_absent===true,callLinksSchema:objects.call_schema===true,callLinksForeignKeys:objects.call_fks===true,callLinksImmutable:objects.call_immutable===true,callLinksPermissions:objects.call_permissions===true,callLinksReferencesSound:objects.call_refs===true,leadCommandsAbsent:objects.lead_absent===true,leadCommandsSchema:objects.lead_schema===true,leadCommandsForeignKeys:objects.lead_fks===true,leadCommandsImmutable:objects.lead_immutable===true,leadCommandsPermissions:objects.lead_permissions===true,leadCommandsReferencesSound:objects.lead_refs===true,groupInterestAbsent:extension.group_absent===true,groupInterestReady:extension.group_ready===true&&groupSemantic,providerIndexAbsent:extension.provider_absent===true,providerIndexReady:extension.provider_ready===true&&providerSemantic,audienceInterestAbsent:extension.audience_absent===true,audienceInterestReady:extension.audience_ready===true&&audienceSemantic,extensionDigest};
}

export function contactWorkStateDigest(history:readonly AppliedMigration[],snapshot:ContactWorkSnapshot):string{
 return createHash('sha256').update(JSON.stringify({history:history.map(row=>({name:row.name,checksum:row.checksum})),snapshot})).digest('hex');
}

export function contactWorkSourceBundle(entries:readonly {path:string;bytes:Uint8Array}[]):string{
 const hash=createHash('sha256');for(const entry of entries){const normalized=new TextDecoder('utf-8',{fatal:true}).decode(entry.bytes).replace(/\r\n/g,'\n');hash.update(entry.path).update('\0').update(createHash('sha256').update(normalized).digest('hex')).update('\n');}return hash.digest('hex');
}
