import 'server-only';
import {AppError} from '../../lib/errors.ts';
import type {Actor,WorkspaceId,IdentityClock} from '../identity/types.ts';
import {one} from '../identity/store.ts';
import {billingId} from './contracts.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {newYorkDate} from './contracts-v2.ts';
import type {BillingContext} from './native.ts';
import {FishingProgramSourceNativeV3} from './program-source-native-v3.ts';
import {FishingBillingGuestOwnerStore,type AnchoredPlanningDataV3} from '../../lib/fishing-billing-guest-owner-store.ts';
import {FULFILLMENT_V1,fulfillmentCommandV1Schema,fulfillmentRecordV1Schema,fulfillmentPlanSnapshotV1Schema,
 type FulfillmentCommandV1,type FulfillmentRecordV1,type FulfillmentPlanSnapshotV1} from './fulfillment-contract-v1.ts';

type Kind=FulfillmentRecordV1['kind'];
type Stored={record:FulfillmentRecordV1;digest:string};
type Row={kind:Kind;id:string;revision:number;headDigest:string;workspaceId:string;recordKind:Kind;recordId:string;recordRevision:number;
 groupId:string|null;quoteId:string|null;operationId:string;actorId:string;recordedAt:Date;requestDigest:string;digest:string;previousDigest:string|null;ciphertext:string};
const columns=`v.workspace_id AS "workspaceId",v.kind AS "recordKind",v.entity_id AS "recordId",v.revision AS "recordRevision",v.group_id AS "groupId",v.quote_id AS "quoteId",
 v.operation_id AS "operationId",v.recorded_by AS "actorId",v.recorded_at AS "recordedAt",v.request_digest AS "requestDigest",v.record_digest AS digest,
 v.previous_digest AS "previousDigest",v.payload_ciphertext AS ciphertext`;
const current=`SELECT h.kind,h.entity_id AS id,h.revision,h.record_digest AS "headDigest",${columns}
 FROM ls_fishing_billing.fulfillment_heads h LEFT JOIN ls_fishing_billing.fulfillment_versions v
 ON v.workspace_id=h.workspace_id AND v.kind=h.kind AND v.entity_id=h.entity_id AND v.revision=h.revision`;
const exact=`SELECT v.kind,v.entity_id AS id,v.revision,v.record_digest AS "headDigest",${columns} FROM ls_fishing_billing.fulfillment_versions v`;
function fail(code:'UNAVAILABLE'|'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'='UNAVAILABLE'):never{throw new AppError(code);}

/** Native owner calendar/planning facts only. No paid entitlement, seat hold,
 * signature, refund, activation or transport approval is created here. The
 * eventual prospective agreement must bind this exact snapshot and separately
 * admit actual capacity/known-send holds before taking money. */
export class FishingFulfillmentNativeV1{
 constructor(private readonly workspaceId:WorkspaceId,private readonly programme:FishingProgramSourceNativeV3,
  private readonly billing:FishingBillingGuestOwnerStore,private readonly ring:Keyring,private readonly key:string,private readonly clock:IdentityClock){
  if(key.length<32||!billingId.safeParse(workspaceId).success)fail();
 }
 private hash(value:unknown){return privateDigest(value,this.key);}
 private request(actorId:string,command:FulfillmentCommandV1){return this.hash({domain:FULFILLMENT_V1,workspaceId:this.workspaceId,actorId,command});}
 private aad(kind:Kind,id:string,revision:number){return `ls_fishing_billing/fulfillment/v1/${this.workspaceId}/${kind}/${id}/${revision}`;}
 private context(c:Readonly<BillingContext>){if(c.workspaceId!==this.workspaceId||c.actor.workspaceId!==this.workspaceId)fail('FORBIDDEN');}
 private decode(row:Row):Stored{
  try{
   const record=fulfillmentRecordV1Schema.parse(JSON.parse(unseal(row.ciphertext,this.aad(row.kind,row.id,row.revision),this.ring))),command=record.command;
   const id=command.action==='record_departure'?command.id:command.quoteId;
   if(record.workspaceId!==this.workspaceId||row.workspaceId!==this.workspaceId||record.kind!==row.kind||row.recordKind!==row.kind||id!==row.id||row.recordId!==row.id||
    record.revision!==row.revision||row.recordRevision!==row.revision||record.recordedBy!==row.actorId||command.operationId!==row.operationId||record.recordedAt!==row.recordedAt.toISOString()||
    record.previousDigest!==row.previousDigest||row.requestDigest!==this.request(record.recordedBy,command)||row.digest!==row.headDigest||row.digest!==this.hash({domain:'fulfillment-record/v1',record})||
    (command.action==='record_departure'?(row.groupId!==command.groupId||row.quoteId!==null):(row.groupId!==null||row.quoteId!==command.quoteId)))fail();
   return {record,digest:row.digest};
  }catch{fail();}
 }
 private async get(c:Readonly<BillingContext>,kind:Kind,id:string){
  this.context(c);const rows=await c.tx.query<Row>(current+' WHERE h.workspace_id=$1 AND h.kind=$2 AND h.entity_id=$3 LIMIT 2 FOR SHARE OF h',[this.workspaceId,kind,id]);
  if(rows.length>1)fail();return rows[0]?this.decode(rows[0]):null;
 }
 private async version(c:Readonly<BillingContext>,kind:Kind,id:string,revision:number){
  this.context(c);
  const rows=await c.tx.query<Row>(exact+' WHERE v.workspace_id=$1 AND v.kind=$2 AND v.entity_id=$3 AND v.revision=$4',[this.workspaceId,kind,id,revision]);
  if(rows.length!==1)fail();return this.decode(rows[0]!);
 }
 private async original(c:Readonly<BillingContext>,command:FulfillmentCommandV1){
  const rows=await c.tx.query<Row>(exact+' WHERE v.workspace_id=$1 AND v.operation_id=$2 LIMIT 2',[this.workspaceId,command.operationId]);
  if(rows.length>1)fail();if(!rows[0])return null;const saved=this.decode(rows[0]);
  if(this.request(c.actor.id,command)!==this.request(saved.record.recordedBy,saved.record.command))fail('CONFLICT');return saved;
 }
 private async departures(c:Readonly<BillingContext>){
  const rows=await c.tx.query<Row>(current+" WHERE h.workspace_id=$1 AND h.kind='departure' ORDER BY h.entity_id LIMIT 1001 FOR SHARE OF h",[this.workspaceId]);
  if(rows.length>1000)fail();return rows.map(row=>this.decode(row));
 }
 private basis(data:AnchoredPlanningDataV3){
  const q=data.quote;return this.hash({domain:'fulfillment-quote-basis/v1',id:q.id,workspaceId:q.workspaceId,familyId:q.familyId,
   definition:q.definition,lines:q.lines,override:q.override,createdAt:q.createdAt});
 }
 private verifyPlan(saved:Stored,data:AnchoredPlanningDataV3){
  const r=saved.record;if(r.kind!=='plan')fail();const s=r.snapshot,q=data.quote;
  if(s.quoteId!==q.id||s.familyId!==q.familyId||s.quoteBasisDigest!==this.basis(data)||s.children.length!==q.lines.length||r.command.children.length!==q.lines.length)fail();
  const selected=new Map(r.command.children.map(child=>[child.lineId,child]));
  for(const [index,line] of q.lines.entries()){
   const child=s.children[index],original=data.original.periods.find(p=>p.lineId===line.id),choice=selected.get(line.id);
   if(!child||!original||!choice||child.lineId!==line.id||child.childId!==line.childId||child.groupId!==line.groupId||
    this.hash(child.period)!==this.hash(line.period)||this.hash(child.firstEligibleLesson)!==this.hash(original.lesson)||
    child.keys.id!==choice.keys.id||child.keys.revision!==choice.keys.expectedRevision||child.local.id!==choice.local.id||child.local.revision!==choice.local.expectedRevision)fail();
   for(const [kind,trip] of [['keys',child.keys],['local',child.local]] as const){
    if(trip.fields.tripKind!==kind||trip.groupId!==child.groupId||trip.fields.state!=='scheduled'||Date.parse(trip.fields.startsAt)<Date.parse(line.period.startsAt)||Date.parse(trip.fields.endsAt)>Date.parse(line.period.endsAt))fail();
   }
  }
 }
 private async append(c:Readonly<BillingContext>,record:FulfillmentRecordV1,before:Stored|null){
  const command=record.command,id=command.action==='record_departure'?command.id:command.quoteId,digest=this.hash({domain:'fulfillment-record/v1',record});
  await c.tx.query('INSERT INTO ls_fishing_billing.fulfillment_versions(workspace_id,kind,entity_id,group_id,quote_id,revision,operation_id,recorded_by,recorded_at,request_digest,record_digest,previous_digest,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
   [this.workspaceId,record.kind,id,command.action==='record_departure'?command.groupId:null,command.action==='prepare_plan'?command.quoteId:null,record.revision,command.operationId,c.actor.id,record.recordedAt,this.request(c.actor.id,command),digest,record.previousDigest,seal(JSON.stringify(record),this.aad(record.kind,id,record.revision),this.ring)]);
  if(before){const changed=await one(c.tx,'UPDATE ls_fishing_billing.fulfillment_heads SET revision=$4,record_digest=$5 WHERE workspace_id=$1 AND kind=$2 AND entity_id=$3 AND revision=$6 AND record_digest=$7 RETURNING entity_id',
   [this.workspaceId,record.kind,id,record.revision,digest,before.record.revision,before.digest]);if(!changed)fail('CONFLICT');}
  else await c.tx.query('INSERT INTO ls_fishing_billing.fulfillment_heads(workspace_id,kind,entity_id,revision,record_digest) VALUES($1,$2,$3,$4,$5)',[this.workspaceId,record.kind,id,record.revision,digest]);
  return {record,digest,replayed:false};
 }
 async recordDeparture(actor:Actor,raw:unknown){
  const command=fulfillmentCommandV1Schema.parse(raw);if(command.action!=='record_departure')throw new AppError('INVALID_REQUEST');
  return this.programme.withOwnerTransaction(actor,async c=>{
   this.context(c);const group=await this.programme.readGroupDataInTransaction(c,command.groupId);
   const old=await this.original(c,command);if(old)return {...old,replayed:true};
   const before=await this.get(c,'departure',command.id);if((before?.record.revision??0)!==command.expectedRevision)fail('CONFLICT');
   if(before&&(before.record.kind!=='departure'||before.record.command.groupId!==command.groupId))fail('CONFLICT');
   if(group.group.record.command.kind!=='group'||command.fields.state==='scheduled'&&group.group.record.command.fields.state!=='forming')fail('CONFLICT');
   if(command.fields.state==='scheduled'){
    const month=newYorkDate(command.fields.startsAt).slice(0,7),date=newYorkDate(command.fields.startsAt);
    const ordinary=(await this.departures(c)).filter(s=>s.record.kind==='departure'&&s.record.command.id!==command.id&&s.record.command.fields.state==='scheduled'&&newYorkDate(s.record.command.fields.startsAt).slice(0,7)===month);
    if(ordinary.length>=4||ordinary.some(s=>s.record.kind==='departure'&&newYorkDate(s.record.command.fields.startsAt)===date))fail('CONFLICT');
   }
   const record=fulfillmentRecordV1Schema.parse({version:FULFILLMENT_V1,workspaceId:this.workspaceId,kind:'departure',revision:command.expectedRevision+1,
    command,recordedBy:c.actor.id,recordedAt:this.clock.now().toISOString(),previousDigest:before?.digest??null});
   return this.append(c,record,before);
  });
 }
 async readDepartures(actor:Actor,groupId:string){
  return this.programme.withOwnerTransaction(actor,async c=>{this.context(c);await this.programme.readGroupDataInTransaction(c,groupId);
   return {version:FULFILLMENT_V1,classification:'owner_entered_planning_not_operating_authority' as const,departures:(await this.departures(c)).filter(s=>s.record.kind==='departure'&&s.record.command.groupId===groupId)};
  });
 }
 async preparePlan(actor:Actor,raw:unknown){
  const command=fulfillmentCommandV1Schema.parse(raw);if(command.action!=='prepare_plan')throw new AppError('INVALID_REQUEST');
  return this.billing.withAnchoredPlanning(actor,command.quoteId,async(c,data)=>{
   this.context(c);const q=data.quote;
   for(const group of new Set(q.lines.map(line=>line.groupId)))if(group)await this.programme.readGroupDataInTransaction(c,group);else fail();
   const old=await this.original(c,command);if(old){this.verifyPlan(old,data);return {...old,replayed:true};}
   if(q.state!=='draft'||q.acceptance!==null||q.revision!==command.expectedQuoteRevision)fail('CONFLICT');
   const before=await this.get(c,'plan',q.id);if((before?.record.revision??0)!==command.expectedRevision)fail('CONFLICT');
   if(command.children.length!==q.lines.length||q.lines.some(line=>!command.children.some(child=>child.lineId===line.id)))fail('CONFLICT');
   const live=await this.programme.firstEligibleLessons(c,{quoteId:q.id,familyId:q.familyId,children:data.original.periods.map(p=>({lineId:p.lineId,childId:p.childId,periodId:p.period.id,
    groupId:p.lesson.groupId,firstEligibleLessonId:p.lesson.id,expectedLessonRevision:p.lesson.revision,dueAt:q.lines.find(l=>l.id===p.lineId)!.dueAt}))});
   if(!live||live.length!==data.original.periods.length||live.some((lesson,index)=>this.hash(lesson)!==this.hash(data.original.periods[index]!.lesson)))fail('CONFLICT');
   const snapshot:FulfillmentPlanSnapshotV1={quoteId:q.id,familyId:q.familyId,quoteBasisDigest:this.basis(data),classification:'prospective_plan_not_reserved_or_paid',children:[]};
   const counts=new Map<string,{count:number;capacity:number}>();
   for(const line of q.lines){
    const choice=command.children.find(child=>child.lineId===line.id)!,original=data.original.periods.find(p=>p.lineId===line.id)!;
    const trips=[];
    for(const kind of ['keys','local'] as const){
     const selected=choice[kind],trip=await this.get(c,'departure',selected.id);
     if(!trip||trip.record.kind!=='departure'||trip.record.revision!==selected.expectedRevision)fail('CONFLICT');
     const t=trip.record.command;
     if(t.groupId!==line.groupId||t.fields.tripKind!==kind||t.fields.state!=='scheduled'||Date.parse(t.fields.startsAt)<Date.parse(line.period.startsAt)||Date.parse(t.fields.endsAt)>Date.parse(line.period.endsAt))fail('CONFLICT');
     const count=counts.get(t.id)?.count??0;counts.set(t.id,{count:count+1,capacity:t.fields.childCapacity});
     trips.push({id:t.id,groupId:t.groupId,revision:trip.record.revision,digest:trip.digest,fields:t.fields});
    }
    snapshot.children.push({lineId:line.id,childId:line.childId,groupId:line.groupId!,period:line.period,firstEligibleLesson:original.lesson,keys:trips[0]!,local:trips[1]!});
   }
   if([...counts.values()].some(count=>count.count>count.capacity))fail('CONFLICT');
   const record=fulfillmentRecordV1Schema.parse({version:FULFILLMENT_V1,workspaceId:this.workspaceId,kind:'plan',revision:command.expectedRevision+1,command,
    recordedBy:c.actor.id,recordedAt:this.clock.now().toISOString(),previousDigest:before?.digest??null,snapshot:fulfillmentPlanSnapshotV1Schema.parse(snapshot)});
   const saved={record,digest:this.hash({domain:'fulfillment-record/v1',record})};this.verifyPlan(saved,data);return this.append(c,record,before);
  });
 }
 async readPlan(actor:Actor,quoteId:string){
  return this.billing.withAnchoredPlanning(actor,quoteId,async(c,data)=>{
   this.context(c);for(const group of new Set(data.quote.lines.map(line=>line.groupId)))if(group)await this.programme.readGroupDataInTransaction(c,group);else fail();
   const saved=await this.get(c,'plan',quoteId);if(!saved)fail('NOT_FOUND');this.verifyPlan(saved,data);if(saved.record.kind!=='plan')fail();
   const changed=new Set<string>();
   for(const child of saved.record.snapshot.children)for(const trip of [child.keys,child.local]){
    const original=await this.version(c,'departure',trip.id,trip.revision);if(original.digest!==trip.digest||original.record.kind!=='departure'||this.hash(original.record.command.fields)!==this.hash(trip.fields))fail();
    const live=await this.get(c,'departure',trip.id);if(!live||live.digest!==trip.digest)changed.add(trip.id);
   }
   return {version:FULFILLMENT_V1,classification:'historical_plan_not_eligibility' as const,plan:saved,
    departureSourceState:changed.size?'changed' as const:'unchanged' as const,changedDepartureIds:[...changed]};
  });
 }
}
