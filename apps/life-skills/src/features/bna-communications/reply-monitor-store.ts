import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {Actor,IdentityClock} from '../identity/types.ts';
import {bnaReplySelector} from './reply-contract.ts';
import type {BnaGmailReplyReader} from './gmail-reply-reader.ts';
import type {BnaReplyStore} from './reply-store.ts';
import type {BnaReplySourceCatalog} from './reply-source-catalog.ts';

const hash=z.string().regex(/^[a-f0-9]{64}$/),LEASE_MS=300000;
export const BNA_REPLY_COVERAGE_MAX_AGE_MS=180000;
const admissionSchema=z.strictObject({primaryMailbox:z.email().max(254).refine(s=>/^[\x21-\x7e]+$/.test(s)).transform(s=>s.toLowerCase()),
 monitorFrom:z.iso.datetime(),sourceSince:z.iso.datetime(),inquiryIds:z.array(z.uuid()).min(1).max(100).nullable(),policyDigest:hash});
export type BnaReplyMonitorAdmission=z.infer<typeof admissionSchema>;
const state=z.enum(['reading','batch_saved','completed','failed']);
const code=z.enum(['CYCLE_STARTED','READ_RESERVED','READ_RECLAIMED','READ_RETRY','BATCH_SAVED','CYCLE_COMPLETED','READ_FAILED']);
const counts=z.strictObject({received:z.number().int().min(0).max(250),replayed:z.number().int().min(0).max(250)});
const event=z.strictObject({format:z.literal(1),journalVersion:z.number().int().min(1).max(2147483646),operationId:z.uuid(),cycleId:z.uuid(),
 ownerId:z.uuid(),mailboxKey:hash,bindingDigest:hash,sourceDigest:hash,sourceCount:z.number().int().min(0).max(10000),
 cursor:z.number().int().min(0).max(10000),batchEnd:z.number().int().min(0).max(10000),state,code,
 startedAt:z.iso.datetime(),recordedAt:z.iso.datetime(),leaseUntil:z.iso.datetime().nullable(),
 selectors:z.array(bnaReplySelector).max(10000).nullable(),result:counts.nullable()});
type Event=z.infer<typeof event>;
type Row={version:number;operationId:string;cycleId:string;ownerId:string;mailboxKey:string;bindingDigest:string;sourceDigest:string;sourceCount:number;
 cursor:number;batchEnd:number;state:Event['state'];code:Event['code'];startedAt:Date;recordedAt:Date;leaseUntil:Date|null;digest:string;ciphertext:string};
const columns=`version,operation_id AS "operationId",cycle_id AS "cycleId",owner_account_id AS "ownerId",mailbox_key AS "mailboxKey",binding_digest AS "bindingDigest",source_digest AS "sourceDigest",source_count AS "sourceCount",cursor,batch_end AS "batchEnd",state,code,started_at AS "startedAt",recorded_at AS "recordedAt",lease_until AS "leaseUntil",payload_digest AS digest,payload_ciphertext AS ciphertext`;
type Reader=Pick<BnaGmailReplyReader,'readRepliesForBinding'|'verifyMailboxForBinding'>;
type Reservation={binding:ReturnType<BnaReplyMonitorStore['binding']>;event:Event;selectors:z.infer<typeof bnaReplySelector>[]};
export type BnaReplyMonitorStatus={state:'unconnected'|'paused'|'checking'|'failed'|'stale'|'connected';lastCheckedAt:string|null;coverageFrom:string|null};

/** Server-only bounded polling journal. A lease reserves provider READs; saved
 * receipts, initial reviews and cursor advancement share one transaction.
 * Construction never starts a worker or grants mailbox/sending authority. */
export class BnaReplyMonitorStore{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ownerId:string,
  private readonly ring:Keyring,private readonly key:string,private readonly clock:IdentityClock,
  private readonly catalog:Pick<BnaReplySourceCatalog,'snapshot'>,private readonly replies:Pick<BnaReplyStore,'ingest'>,
  private readonly admission:()=>BnaReplyMonitorAdmission|null=()=>null){}
 private digest(domain:string,value:unknown){return privateDigest({domain,workspace:this.workspace,value},this.key);}
 private aad(operationId:string){return `ls_service_interest/bna-mailbox-monitor/v1/${this.workspace}/${operationId}`;}
 private binding(){
  const a=admissionSchema.parse(this.admission()),now=this.clock.now();
  if(!Number.isFinite(now.getTime())||Date.parse(a.monitorFrom)>now.getTime()||Date.parse(a.sourceSince)>now.getTime()||
   a.inquiryIds&&new Set(a.inquiryIds).size!==a.inquiryIds.length)throw new AppError('UNAVAILABLE');
  a.inquiryIds?.sort();return {...a,mailboxKey:this.digest('bna-mailbox-primary/v1',a.primaryMailbox),bindingDigest:this.digest('bna-mailbox-monitor-binding/v1',a)};
 }
 private async activeOwner(tx:SqlSession){
  if(!await one(tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[this.workspace,this.ownerId]))throw new AppError('UNAVAILABLE');
 }
 private async owner(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.workspace||actor.id!==this.ownerId)throw new AppError('NOT_FOUND');
  const a=await freshActor(tx,actor,this.clock.now());if(a.role!=='practitioner'||a.state!=='active')throw new AppError('NOT_FOUND');
 }
 private decode(row:Row){try{
  const p=event.parse(JSON.parse(unseal(row.ciphertext,this.aad(row.operationId),this.ring)));
  if(this.digest('bna-mailbox-monitor-event/v1',p)!==row.digest||p.ownerId!==this.ownerId||p.ownerId!==row.ownerId||
   p.journalVersion!==row.version||p.operationId!==row.operationId||p.cycleId!==row.cycleId||p.mailboxKey!==row.mailboxKey||
   p.bindingDigest!==row.bindingDigest||p.sourceDigest!==row.sourceDigest||p.sourceCount!==row.sourceCount||p.cursor!==row.cursor||
   p.batchEnd!==row.batchEnd||p.state!==row.state||p.code!==row.code||p.startedAt!==row.startedAt.toISOString()||
   p.recordedAt!==row.recordedAt.toISOString()||p.leaseUntil!==(row.leaseUntil?.toISOString()??null)||row.recordedAt>this.clock.now()||
   row.recordedAt<row.startedAt||p.cursor>p.batchEnd||p.batchEnd>p.sourceCount||p.batchEnd-p.cursor>25)throw Error();
  if(p.state==='reading'?(p.batchEnd!==Math.min(p.cursor+25,p.sourceCount)||!p.leaseUntil||Date.parse(p.leaseUntil)!==row.recordedAt.getTime()+LEASE_MS||p.result!==null||
    !['CYCLE_STARTED','READ_RESERVED','READ_RECLAIMED','READ_RETRY'].includes(p.code)):
   (p.leaseUntil!==null||p.batchEnd!==p.cursor||
    (p.state==='completed'?(p.cursor!==p.sourceCount||p.code!=='CYCLE_COMPLETED'||p.result===null):
     p.state==='batch_saved'?(p.cursor>=p.sourceCount||p.code!=='BATCH_SAVED'||p.result===null):(p.code!=='READ_FAILED'||p.result!==null))))throw Error();
  if(p.code==='CYCLE_STARTED'?(p.selectors===null||p.selectors.length!==p.sourceCount||p.cursor!==0||p.startedAt!==p.recordedAt||
    new Set(p.selectors.map(s=>s.messageId)).size!==p.sourceCount):p.selectors!==null)throw Error();
  return p;
 }catch{throw new AppError('UNAVAILABLE');}}
 private async latest(tx:SqlSession,mailboxKey:string){
  const row=await one<Row>(tx,`SELECT ${columns} FROM ls_service_interest.bna_mailbox_monitor_events WHERE workspace_id=$1 AND mailbox_key=$2 ORDER BY version DESC LIMIT 1`,[this.workspace,mailboxKey]);
  return row?this.decode(row):null;
 }
 private async snapshotFor(tx:SqlSession,p:Event){
  const row=await one<Row>(tx,`SELECT ${columns} FROM ls_service_interest.bna_mailbox_monitor_events WHERE workspace_id=$1 AND mailbox_key=$2 AND cycle_id=$3 AND code='CYCLE_STARTED'`,[this.workspace,p.mailboxKey,p.cycleId]);
  if(!row)throw new AppError('UNAVAILABLE');const start=this.decode(row);
  if(start.bindingDigest!==p.bindingDigest||start.sourceDigest!==p.sourceDigest||start.sourceCount!==p.sourceCount||start.startedAt!==p.startedAt)throw new AppError('UNAVAILABLE');
  return start.selectors!;
 }
 private async append(tx:SqlSession,p:Event){
  event.parse(p);
  await tx.query(`INSERT INTO ls_service_interest.bna_mailbox_monitor_events(workspace_id,mailbox_key,version,operation_id,cycle_id,owner_account_id,binding_digest,source_digest,source_count,cursor,batch_end,state,code,started_at,recorded_at,lease_until,payload_digest,payload_ciphertext)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,[this.workspace,p.mailboxKey,p.journalVersion,p.operationId,p.cycleId,this.ownerId,
    p.bindingDigest,p.sourceDigest,p.sourceCount,p.cursor,p.batchEnd,p.state,p.code,p.startedAt,p.recordedAt,p.leaseUntil,
    this.digest('bna-mailbox-monitor-event/v1',p),seal(JSON.stringify(p),this.aad(p.operationId),this.ring)]);
 }
 private async reserve():Promise<Reservation|null>{
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.activeOwner(tx);const binding=this.binding(),now=this.clock.now(),time=now.toISOString();
   const previous=await this.latest(tx,binding.mailboxKey);let p:Event,selectors:z.infer<typeof bnaReplySelector>[];
   if(!previous||previous.state==='completed'||previous.bindingDigest!==binding.bindingDigest){
    const snapshot=await this.catalog.snapshot(tx,binding);selectors=snapshot.selectors;
    p={format:1,journalVersion:(previous?.journalVersion??0)+1,operationId:randomUUID(),cycleId:randomUUID(),ownerId:this.ownerId,mailboxKey:binding.mailboxKey,
     bindingDigest:binding.bindingDigest,sourceDigest:snapshot.digest,sourceCount:selectors.length,cursor:0,batchEnd:Math.min(25,selectors.length),state:'reading',code:'CYCLE_STARTED',
     startedAt:time,recordedAt:time,leaseUntil:new Date(now.getTime()+LEASE_MS).toISOString(),selectors,result:null};
   }else{
    if(previous.state==='reading'&&Date.parse(previous.leaseUntil!)>now.getTime())return null;
    selectors=await this.snapshotFor(tx,previous);
    p={...previous,journalVersion:previous.journalVersion+1,operationId:randomUUID(),state:'reading',
     code:previous.state==='reading'?'READ_RECLAIMED':previous.state==='failed'?'READ_RETRY':'READ_RESERVED',
     batchEnd:Math.min(previous.cursor+25,previous.sourceCount),recordedAt:time,leaseUntil:new Date(now.getTime()+LEASE_MS).toISOString(),selectors:null,result:null};
   }
   await this.append(tx,p);return {binding,event:p,selectors:selectors.slice(p.cursor,p.batchEnd)};
  });
 }
 private async currentClaim(tx:SqlSession,r:Reservation){
  await this.activeOwner(tx);const current=await this.latest(tx,r.event.mailboxKey);
  if(this.binding().bindingDigest!==r.binding.bindingDigest||!current||current.operationId!==r.event.operationId||current.state!=='reading'||
   Date.parse(current.leaseUntil!)<=this.clock.now().getTime())throw new AppError('CONFLICT');return current;
 }
 private async saved(tx:SqlSession,r:Reservation,result:z.infer<typeof counts>){
  const current=await this.currentClaim(tx,r),cursor=current.batchEnd,completed=cursor===current.sourceCount;
  await this.append(tx,{...current,journalVersion:current.journalVersion+1,operationId:randomUUID(),cursor,batchEnd:cursor,
   state:completed?'completed':'batch_saved',code:completed?'CYCLE_COMPLETED':'BATCH_SAVED',recordedAt:this.clock.now().toISOString(),leaseUntil:null,selectors:null,result});
 }
 /** Executes at most one 25-source batch. Calling while another reader owns
  * its lease does no provider work. Unknown commit results reconcile natively. */
 async runBatch(reader:Reader){
  const r=await this.reserve();if(!r)return {state:'busy' as const};
  try{
   let result:{received:number;replayed:number};
   if(r.selectors.length)result=await this.replies.ingest(r.selectors,reader,(tx,value)=>this.saved(tx,r,value));
   else{
    const verified=await reader.verifyMailboxForBinding({primaryMailbox:r.binding.primaryMailbox,monitorFrom:r.binding.monitorFrom});
    if(verified.verified!==true)throw new AppError('UNAVAILABLE');result={received:0,replayed:0};
    await this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.saved(tx,r,result);});
   }
   return {state:r.event.batchEnd===r.event.sourceCount?'completed' as const:'batch_saved' as const,...result,reconciled:false};
  }catch{
   // A committed but lost result must not be changed into READ_FAILED. Under
   // the same workspace lock, the immediate successor proves this batch save.
   return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.activeOwner(tx);
    const row=await one<Row>(tx,`SELECT ${columns} FROM ls_service_interest.bna_mailbox_monitor_events WHERE workspace_id=$1 AND mailbox_key=$2 AND version=$3`,[this.workspace,r.event.mailboxKey,r.event.journalVersion+1]);
    if(row){const saved=this.decode(row);if(saved.cycleId===r.event.cycleId&&saved.bindingDigest===r.event.bindingDigest&&saved.sourceDigest===r.event.sourceDigest&&
     saved.cursor===r.event.batchEnd&&['completed','batch_saved'].includes(saved.state)&&saved.result)return {state:saved.state as 'completed'|'batch_saved',...saved.result,reconciled:true};}
    const current=await this.latest(tx,r.event.mailboxKey);
    if(!current||current.operationId!==r.event.operationId||!this.admission()||this.binding().bindingDigest!==r.binding.bindingDigest)return {state:'superseded' as const};
    await this.append(tx,{...current,journalVersion:current.journalVersion+1,operationId:randomUUID(),batchEnd:current.cursor,state:'failed',code:'READ_FAILED',
     recordedAt:this.clock.now().toISOString(),leaseUntil:null,selectors:null,result:null});return {state:'failed' as const};
   });
  }
 }
 async status(actor:Actor):Promise<BnaReplyMonitorStatus>{return this.db.transaction(async tx=>{
  await tx.query('SET TRANSACTION READ ONLY');await this.owner(tx,actor);
  if(!this.admission()){
   const row=await one<{version:number}>(tx,'SELECT version FROM ls_service_interest.bna_mailbox_monitor_events WHERE workspace_id=$1 AND owner_account_id=$2 ORDER BY recorded_at DESC,version DESC LIMIT 1',[this.workspace,this.ownerId]);
   return {state:row?'paused':'unconnected',lastCheckedAt:null,coverageFrom:null};
  }
  const binding=this.binding(),latest=await this.latest(tx,binding.mailboxKey);
  if(!latest||latest.bindingDigest!==binding.bindingDigest)return {state:'unconnected',lastCheckedAt:null,coverageFrom:null};
  const completedRow=await one<Row>(tx,`SELECT ${columns} FROM ls_service_interest.bna_mailbox_monitor_events WHERE workspace_id=$1 AND mailbox_key=$2 AND binding_digest=$3 AND state='completed' ORDER BY version DESC LIMIT 1`,[this.workspace,binding.mailboxKey,binding.bindingDigest]);
  const completed=completedRow?this.decode(completedRow):null,checked={lastCheckedAt:completed?.recordedAt??null,coverageFrom:completed?.startedAt??null};
  if(latest.state==='failed')return {state:'failed',...checked};
  if(latest.state==='reading'&&Date.parse(latest.leaseUntil!)<=this.clock.now().getTime())return {state:'stale',...checked};
  const snapshot=await this.catalog.snapshot(tx,binding);
  const fresh=completed&&completed.sourceDigest===snapshot.digest&&this.clock.now().getTime()-Date.parse(completed.startedAt)<=BNA_REPLY_COVERAGE_MAX_AGE_MS;
  return {state:fresh?'connected':latest.state==='completed'?'stale':'checking',...checked};
 });}
 /** Ongoing polling requires an actual completed controlled read with at
  * least one newly saved reply, bound to this same mailbox and owner. */
 async verifyControlledCycle(proof:{cycleId:string;bindingDigest:string}){
  z.uuid().parse(proof.cycleId);hash.parse(proof.bindingDigest);const binding=this.binding();
  return this.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');await this.activeOwner(tx);
   const row=await one<Row>(tx,`SELECT ${columns} FROM ls_service_interest.bna_mailbox_monitor_events WHERE workspace_id=$1 AND mailbox_key=$2 AND cycle_id=$3 AND state='completed'`,[this.workspace,binding.mailboxKey,proof.cycleId]);
   if(!row)throw new AppError('UNAVAILABLE');const p=this.decode(row);
   if(p.bindingDigest!==proof.bindingDigest||p.sourceCount<1||p.sourceCount>4||!p.result||p.result.received<1)throw new AppError('UNAVAILABLE');
   await this.snapshotFor(tx,p);
  });
 }
}
