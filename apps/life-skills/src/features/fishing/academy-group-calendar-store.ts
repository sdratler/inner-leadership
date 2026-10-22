import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type SqlSession} from '../identity/store.ts';
import {digest} from '../fishing-payments/domain.ts';
import {academyGroupDraftCommandSchema,academyGroupDraftReceiptSchema,academyGroupEventRecordSchema,type AcademyGroupDraftCommand,type AcademyGroupDraftReceipt,type AcademyGroupEventRecord} from './academy-group-calendar-contract.ts';
import {academyKeysPublicationTables,academyKeysImmutableTriggers} from './academy-group-calendar-publication-contract.ts';

const aad=(kind:'revision'|'command',workspace:string,id:string)=>`academy-group-calendar:v1:${kind}:${workspace}:${id}`;
const journalSchema=z.strictObject({command:academyGroupDraftCommandSchema,receipt:academyGroupDraftReceiptSchema});
function unavailable():never{throw new AppError('UNAVAILABLE');}
type RevisionRow={operatorId:string;month:string;kind:string;revision:number;previousSha256:string|null;sha256:string;state:string;operationId:string;ciphertext:string;recordedAt:Date};
/** Storage port only: caller holds the common workspace lock and supplies
 * freshly authorized native originals. History never rewrites Stage records. */
export class AcademyGroupCalendarStore{
 constructor(private tx:SqlSession,private ring:Keyring){}
 private encode(kind:'revision'|'command',workspace:string,id:string,value:unknown){const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>140000)unavailable();return seal(bytes,aad(kind,workspace,id),this.ring);}
 private decode<T>(schema:z.ZodType<T>,kind:'revision'|'command',workspace:string,id:string,ciphertext:string):T{
  try{if(Buffer.byteLength(ciphertext)>196608)unavailable();return schema.parse(JSON.parse(unseal(ciphertext,aad(kind,workspace,id),this.ring)));}catch{unavailable();}
 }
 async configured(){return AcademyGroupCalendarStore.catalog(this.tx);}
 static async catalog(tx:SqlSession){
  const names=['commands','event_revisions','events','original_links'].map(n=>'ls_academy_calendar.'+n);
  const rows=await tx.query<{name:string;relation:string|null;kind:string|null}>(`SELECT e.name,c.oid::regclass::text AS relation,c.relkind AS kind FROM unnest(ARRAY[$1,$2,$3,$4]::text[]) AS e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) ORDER BY e.name`,names);
  const ns=await one<{present:boolean}>(tx,"SELECT to_regnamespace('ls_academy_calendar') IS NOT NULL AS present");
  if(rows.length!==4||!ns||rows.some((r,i)=>r.name!==names[i]))unavailable();
  if(!ns.present&&rows.every(r=>r.relation===null&&r.kind===null))return false;
  if(!ns.present||rows.some(r=>r.relation!==r.name||r.kind!=='r'))unavailable();
  const publicationNames=academyKeysPublicationTables.map(n=>'ls_academy_calendar.'+n),publicationRows=await tx.query<{name:string;relation:string|null;kind:string|null}>(`SELECT e.name,c.oid::regclass::text AS relation,c.relkind AS kind FROM unnest(ARRAY[${publicationNames.map((_,i)=>'$'+(i+1)).join(',')}]::text[]) AS e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) ORDER BY e.name`,publicationNames);
  if(publicationRows.length!==publicationNames.length||publicationRows.some((r,i)=>r.name!==publicationNames[i]))unavailable();
  const publicationAbsent=publicationRows.every(r=>r.relation===null&&r.kind===null),publicationReady=publicationRows.every(r=>r.relation===r.name&&r.kind==='r');if(!publicationAbsent&&!publicationReady)unavailable();
  const tables=await tx.query<{name:string}>("SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_academy_calendar' AND c.relkind IN ('r','p','v','m','f') ORDER BY name");
  if(JSON.stringify(tables.map(r=>r.name))!==JSON.stringify(['commands','event_revisions','events','original_links',...(publicationReady?academyKeysPublicationTables:[])].sort()))unavailable();
  const triggers=await tx.query<{name:string;enabled:string;type:number;functionSchema:string;functionName:string}>("SELECT c.relname||':'||t.tgname AS name,t.tgenabled AS enabled,t.tgtype AS type,pn.nspname AS \"functionSchema\",p.proname AS \"functionName\" FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname='ls_academy_calendar' AND NOT t.tgisinternal ORDER BY name");
  if(JSON.stringify(triggers.map(r=>r.name))!==JSON.stringify(['commands:immutable_calendar_command','event_revisions:immutable_event_revision','events:immutable_event','original_links:immutable_original_link',...(publicationReady?academyKeysImmutableTriggers:[])].sort()))unavailable();
  if(triggers.some(t=>t.enabled!=='O'||t.type!==27||t.functionSchema!=='ls_academy_calendar'||t.functionName!=='reject_history_rewrite'))unavailable();
  const functions=await tx.query<{name:string;body:string;language:string;securityDefiner:boolean;leakproof:boolean;config:string[]|null;ownerMatches:boolean;arguments:string;returns:string}>("SELECT p.proname AS name,p.prosrc AS body,l.lanname AS language,p.prosecdef AS \"securityDefiner\",p.proleakproof AS leakproof,p.proconfig AS config,p.proowner=n.nspowner AS \"ownerMatches\",pg_get_function_identity_arguments(p.oid) AS arguments,p.prorettype::regtype::text AS returns FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='ls_academy_calendar' ORDER BY name");
  const fn=functions[0];if(functions.length!==1||!fn||fn.name!=='reject_history_rewrite'||fn.body.replace(/\s+/g,' ').trim()!=="BEGIN RAISE EXCEPTION 'ACADEMY_GROUP_CALENDAR_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END;"||fn.language!=='plpgsql'||fn.securityDefiner||fn.leakproof||fn.config!==null||!fn.ownerMatches||fn.arguments!==''||fn.returns!=='trigger')unavailable();return true;
 }
 async read(workspace:string,eventId:string,revision?:number):Promise<{record:AcademyGroupEventRecord;sha256:string}|null>{
  const row=await one<RevisionRow>(this.tx,`SELECT e.operator_id AS "operatorId",e.calendar_month AS month,e.kind,r.revision,r.previous_sha256 AS "previousSha256",r.sha256,r.state,r.operation_id AS "operationId",r.payload_ciphertext AS ciphertext,r.recorded_at AS "recordedAt" FROM ls_academy_calendar.events e JOIN ls_academy_calendar.event_revisions r ON r.workspace_id=e.workspace_id AND r.event_id=e.event_id WHERE e.workspace_id=$1 AND e.event_id=$2 ${revision===undefined?'':'AND r.revision=$3'} ORDER BY r.revision DESC LIMIT 1 FOR SHARE OF e,r`,revision===undefined?[workspace,eventId]:[workspace,eventId,revision]);
  if(!row){if(await one(this.tx,'SELECT event_id FROM ls_academy_calendar.events WHERE workspace_id=$1 AND event_id=$2',[workspace,eventId]))unavailable();return null;}
  const v=this.decode(academyGroupEventRecordSchema,'revision',workspace,eventId+'/'+row.revision,row.ciphertext);
  if(v.workspaceId!==workspace||v.eventId!==eventId||v.operatorId!==row.operatorId||v.calendarMonth!==row.month||v.kind!==row.kind||v.revision!==row.revision||v.previousSha256!==row.previousSha256||v.state!==row.state||v.operationId!==row.operationId||v.recordedAt!==row.recordedAt.toISOString()||digest(v)!==row.sha256)unavailable();
  if(v.revision>1){const prior=await one<{sha256:string}>(this.tx,'SELECT sha256 FROM ls_academy_calendar.event_revisions WHERE workspace_id=$1 AND event_id=$2 AND revision=$3 FOR SHARE',[workspace,eventId,v.revision-1]);if(prior?.sha256!==v.previousSha256)unavailable();}
  const links=await this.tx.query<{cohortId:string;stageId:string;occurrenceId:string;revision:number;sha256:string}>(this.linkSql(),[workspace,eventId,v.revision]);
  const expected=v.originals.map(o=>({cohortId:o.selection.cohortId,stageId:o.selection.stageId,occurrenceId:o.selection.occurrenceId,revision:o.selection.expectedRevision,sha256:o.originalSha256})).sort((a,b)=>a.cohortId.localeCompare(b.cohortId));
  if(digest(links)!==digest(expected))unavailable();return {record:v,sha256:row.sha256};
 }
 private linkSql(){return 'SELECT cohort_id AS "cohortId",stage_id AS "stageId",occurrence_id AS "occurrenceId",occurrence_revision AS revision,original_sha256 AS sha256 FROM ls_academy_calendar.original_links WHERE workspace_id=$1 AND event_id=$2 AND event_revision=$3 ORDER BY cohort_id LIMIT 101 FOR SHARE';}
 async list(workspace:string,operator:string,fromMonth:string,toMonth:string){
  const rows=await this.tx.query<{id:string}>('SELECT event_id AS id FROM ls_academy_calendar.events WHERE workspace_id=$1 AND operator_id=$2 AND calendar_month>=$3 AND calendar_month<=$4 ORDER BY calendar_month,event_id LIMIT 121 FOR SHARE',[workspace,operator,fromMonth,toMonth]);if(rows.length>120)unavailable();
  const result=[];for(const row of rows){const v=await this.read(workspace,row.id);if(!v)unavailable();result.push(v.record);}return result;
 }
 async replay(workspace:string,actor:string,command:AcademyGroupDraftCommand){
  const row=await one<{sha256:string;ciphertext:string;eventId:string;revision:number}>(this.tx,'SELECT request_sha256 AS sha256,payload_ciphertext AS ciphertext,event_id AS "eventId",event_revision AS revision FROM ls_academy_calendar.commands WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3 FOR SHARE',[workspace,actor,command.operationId]);if(!row)return null;
  const body=this.decode(journalSchema,'command',workspace,actor+'/'+command.operationId,row.ciphertext);
  if(digest(body.command)!==row.sha256||body.receipt.operationId!==command.operationId||body.receipt.eventId!==row.eventId||body.receipt.revision!==row.revision)unavailable();
  if(digest(command)!==row.sha256)throw new AppError('CONFLICT');
  const saved=await this.read(workspace,row.eventId,row.revision);if(!saved||saved.record.operatorId!==actor||saved.sha256!==body.receipt.sha256||saved.record.state!==body.receipt.state)unavailable();return body.receipt;
 }
 async append(record:AcademyGroupEventRecord,command:AcademyGroupDraftCommand):Promise<AcademyGroupDraftReceipt>{
  const v=academyGroupEventRecordSchema.parse(record),sha256=digest(v);
  if(v.revision===1)await this.tx.query('INSERT INTO ls_academy_calendar.events(workspace_id,event_id,operator_id,calendar_month,kind,created_at) VALUES($1,$2,$3,$4,$5,$6)',[v.workspaceId,v.eventId,v.operatorId,v.calendarMonth,v.kind,new Date(v.recordedAt)]);
  await this.tx.query('INSERT INTO ls_academy_calendar.event_revisions(workspace_id,event_id,revision,previous_sha256,sha256,state,operation_id,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[v.workspaceId,v.eventId,v.revision,v.previousSha256,sha256,v.state,v.operationId,this.encode('revision',v.workspaceId,v.eventId+'/'+v.revision,v),new Date(v.recordedAt)]);
  for(const o of v.originals)await this.tx.query('INSERT INTO ls_academy_calendar.original_links(workspace_id,event_id,event_revision,cohort_id,stage_id,occurrence_id,occurrence_revision,original_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[v.workspaceId,v.eventId,v.revision,o.selection.cohortId,o.selection.stageId,o.selection.occurrenceId,o.selection.expectedRevision,o.originalSha256]);
  const receipt=academyGroupDraftReceiptSchema.parse({version:v.version,operationId:command.operationId,eventId:v.eventId,revision:v.revision,sha256,state:v.state,resourceEffect:'none',purchaseEffect:'none'});
  await this.tx.query('INSERT INTO ls_academy_calendar.commands(workspace_id,actor_id,operation_id,event_id,event_revision,request_sha256,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[v.workspaceId,v.operatorId,command.operationId,v.eventId,v.revision,digest(command),this.encode('command',v.workspaceId,v.operatorId+'/'+command.operationId,{command,receipt}),new Date(v.recordedAt)]);return receipt;
 }
}
