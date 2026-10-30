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
import {bnaEmailRecipientKey} from './acknowledgment-store.ts';
import {bnaNativeReplySource,bnaReceivedReply,bnaReplyKind,bnaReplySelector,bnaReplyReviewCommand,
 type BnaNativeReplySource,type BnaReceivedReply,type BnaReplyReviewCommand,type BnaSentReplySource} from './reply-contract.ts';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const sourceProof=z.strictObject({kind:bnaReplyKind,messageId:z.uuid(),providerId:z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),createdAt:z.iso.datetime(),acceptedAt:z.iso.datetime()});
const receiptPayload=z.strictObject({version:z.literal(1),provider:z.literal('gmail_metadata'),mailboxKey:hash,recipientKey:hash,source:sourceProof,reply:bnaReceivedReply});
const reviewPayload=z.strictObject({version:z.literal(1),receiptId:z.uuid(),operationId:z.uuid(),source:z.enum(['gmail_metadata','owner']),
 state:z.enum(['pending','reviewed']),expectedVersion:z.number().int().min(0).max(1),actorAccountId:z.uuid().nullable(),recordedAt:z.iso.datetime()});
type Receipt={id:string;ownerAccountId:string;mailboxKey:string;providerMessageKey:string;recipientKey:string;inquiryId:string;
 programKey:BnaReceivedReply['program'];sourceKind:BnaNativeReplySource['kind'];sourceMessageId:string;receivedAt:Date;recordedAt:Date;digest:string;ciphertext:string};
type Review={receiptId:string;version:number;operationId:string;actorAccountId:string|null;state:'pending'|'reviewed';code:string;recordedAt:Date;digest:string;ciphertext:string};
type Joined=Receipt&{reviewReceiptId:string;reviewVersion:number;reviewOperationId:string;reviewActor:string|null;reviewState:Review['state'];reviewCode:string;reviewTime:Date;reviewDigest:string;reviewCiphertext:string};
const receiptColumns=`r.id,r.owner_account_id AS "ownerAccountId",r.mailbox_key AS "mailboxKey",r.provider_message_key AS "providerMessageKey",r.recipient_key AS "recipientKey",r.inquiry_id AS "inquiryId",r.program_key AS "programKey",r.source_kind AS "sourceKind",r.source_message_id AS "sourceMessageId",r.received_at AS "receivedAt",r.recorded_at AS "recordedAt",r.payload_digest AS digest,r.payload_ciphertext AS ciphertext`;
const reviewColumns=`e.receipt_id AS "receiptId",e.version,e.operation_id AS "operationId",e.actor_account_id AS "actorAccountId",e.state,e.code,e.recorded_at AS "recordedAt",e.payload_digest AS digest,e.payload_ciphertext AS ciphertext`;
const joinedColumns=receiptColumns+`,e.receipt_id AS "reviewReceiptId",e.version AS "reviewVersion",e.operation_id AS "reviewOperationId",e.actor_account_id AS "reviewActor",e.state AS "reviewState",e.code AS "reviewCode",e.recorded_at AS "reviewTime",e.payload_digest AS "reviewDigest",e.payload_ciphertext AS "reviewCiphertext"`;
const latestReview=`LEFT JOIN LATERAL(SELECT * FROM ls_service_interest.bna_mailbox_reply_reviews e WHERE e.workspace_id=r.workspace_id AND e.receipt_id=r.id ORDER BY e.version DESC LIMIT 1) e ON true`;
export type BnaReplyMailboxAdmission={primaryMailbox:string;monitorFrom:string};
type Sources={service:{replySource(tx:SqlSession,id:string):Promise<BnaNativeReplySource>};optional:{replySource(tx:SqlSession,id:string):Promise<BnaNativeReplySource>}};
type Reader={readRepliesForBinding(sources:readonly BnaSentReplySource[],binding:BnaReplyMailboxAdmission):Promise<BnaReceivedReply[]>};
/** Native reply activity and owner review. Provider events never impersonate a
 * logged-in owner, grant permission, create People, alter service mail, or copy
 * email content. No HTTP receiver/worker is admitted by constructing this store. */
export class BnaReplyStore{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ownerId:string,
  private readonly ring:Keyring,private readonly key:string,private readonly clock:IdentityClock,private readonly sources:Sources,
  private readonly admission:()=>BnaReplyMailboxAdmission|null=()=>null){}
 private digest(domain:string,value:unknown){return privateDigest({domain,workspace:this.workspace,value},this.key);}
 private receiptAad(id:string){return `ls_service_interest/bna-mailbox-reply/v1/${this.workspace}/${id}`;}
 private reviewAad(operation:string){return `ls_service_interest/bna-mailbox-review/v1/${this.workspace}/${operation}`;}
 private async activeOwner(tx:SqlSession){
  if(!(await one(tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[this.workspace,this.ownerId])))throw new AppError('UNAVAILABLE');
 }
 private async owner(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.workspace||actor.id!==this.ownerId)throw new AppError('NOT_FOUND');
  const current=await freshActor(tx,actor,this.clock.now());if(current.id!==this.ownerId||current.role!=='practitioner'||current.state!=='active')throw new AppError('NOT_FOUND');
 }
 private binding(){const a=this.admission();if(!a)throw new AppError('UNAVAILABLE');
  const p=z.strictObject({primaryMailbox:z.email().max(254).transform(s=>s.toLowerCase()),monitorFrom:z.iso.datetime()}).parse(a);
  if(Date.parse(p.monitorFrom)>this.clock.now().getTime())throw new AppError('UNAVAILABLE');
  return {...p,mailboxKey:this.digest('bna-mailbox-primary/v1',p.primaryMailbox)};
 }
 private decode(row:Receipt){try{
  const p=receiptPayload.parse(JSON.parse(unseal(row.ciphertext,this.receiptAad(row.id),this.ring)));
  if(row.ownerAccountId!==this.ownerId||this.digest('bna-mailbox-receipt/v1',p)!==row.digest||p.mailboxKey!==row.mailboxKey||p.recipientKey!==row.recipientKey||
   this.digest('bna-mailbox-provider-message/v1',{mailboxKey:p.mailboxKey,id:p.reply.providerMessageId})!==row.providerMessageKey||p.reply.inquiryId!==row.inquiryId||
   p.reply.program!==row.programKey||p.source.kind!==row.sourceKind||p.source.messageId!==row.sourceMessageId||p.reply.originalMessageId!==row.sourceMessageId||
   p.reply.receivedAt!==row.receivedAt.toISOString()||row.receivedAt>row.recordedAt||row.recordedAt>this.clock.now()||Date.parse(p.source.createdAt)>row.receivedAt.getTime())throw Error();
  return p;
 }catch{throw new AppError('UNAVAILABLE');}}
 private decodeReview(row:Review){try{
  const p=reviewPayload.parse(JSON.parse(unseal(row.ciphertext,this.reviewAad(row.operationId),this.ring)));
  if(this.digest('bna-mailbox-review/v1',p)!==row.digest||p.receiptId!==row.receiptId||p.operationId!==row.operationId||p.state!==row.state||
   p.expectedVersion!==row.version-1||p.actorAccountId!==row.actorAccountId||p.recordedAt!==row.recordedAt.toISOString()||row.recordedAt>this.clock.now()||
   (p.source==='gmail_metadata'?(row.version!==1||p.state!=='pending'||p.actorAccountId!==null||row.code!=='GMAIL_METADATA_RECEIVED'):
    (row.version!==2||p.state!=='reviewed'||p.actorAccountId!==this.ownerId||row.code!=='OWNER_REVIEWED')))throw Error();return p;
 }catch{throw new AppError('UNAVAILABLE');}}
 private async review(tx:SqlSession,id:string){const row=await one<Review>(tx,`SELECT ${reviewColumns} FROM ls_service_interest.bna_mailbox_reply_reviews e WHERE e.workspace_id=$1 AND e.receipt_id=$2 ORDER BY e.version DESC LIMIT 1`,[this.workspace,id]);
  if(!row)throw new AppError('UNAVAILABLE');this.decodeReview(row);return row;}
 private joinedReview(row:Joined){
  if(!row.reviewReceiptId||row.reviewReceiptId!==row.id||!row.reviewTime||row.reviewTime<row.recordedAt)throw new AppError('UNAVAILABLE');
  const review:Review={receiptId:row.reviewReceiptId,version:row.reviewVersion,operationId:row.reviewOperationId,actorAccountId:row.reviewActor,state:row.reviewState,
   code:row.reviewCode,recordedAt:row.reviewTime,digest:row.reviewDigest,ciphertext:row.reviewCiphertext};this.decodeReview(review);return review;
 }
 private async append(tx:SqlSession,receiptId:string,version:1|2,operationId:string,actorId:string|null){
  const now=this.clock.now(),payload:z.infer<typeof reviewPayload>={version:1,receiptId,operationId,source:version===1?'gmail_metadata':'owner',
   state:version===1?'pending':'reviewed',expectedVersion:version-1,actorAccountId:actorId,recordedAt:now.toISOString()};
  await tx.query(`INSERT INTO ls_service_interest.bna_mailbox_reply_reviews(workspace_id,receipt_id,version,operation_id,actor_account_id,state,code,recorded_at,payload_digest,payload_ciphertext)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[this.workspace,receiptId,version,operationId,actorId,payload.state,version===1?'GMAIL_METADATA_RECEIVED':'OWNER_REVIEWED',now,
   this.digest('bna-mailbox-review/v1',payload),seal(JSON.stringify(payload),this.reviewAad(operationId),this.ring)]);
 }
 private async loadSources(tx:SqlSession,selectors:readonly z.infer<typeof bnaReplySelector>[]){
  const sources=[];for(const selector of selectors){const s=bnaNativeReplySource.parse(await this.sources[selector.kind].replySource(tx,selector.messageId));
   if(s.kind!==selector.kind||s.messageId!==selector.messageId||s.recipientKey!==bnaEmailRecipientKey(this.workspace,s.recipient,this.key)||
    Date.parse(s.createdAt)>Date.parse(s.acceptedAt)||Date.parse(s.acceptedAt)>this.clock.now().getTime())throw new AppError('UNAVAILABLE');sources.push(s);}
  if(new Set(sources.map(s=>s.providerId)).size!==sources.length)throw new AppError('UNAVAILABLE');return sources;
 }
 /** Reader performs provider GETs outside the database transaction. The native
  * accepted-send bindings, admission and owner are rechecked before any write.
  * No public/browser payload can manufacture an inbox receipt. */
 async ingest(selectorsInput:readonly z.infer<typeof bnaReplySelector>[],reader:Reader,onSaved?:(tx:SqlSession,result:{received:number;replayed:number})=>Promise<void>){
  const selectors=z.array(bnaReplySelector).min(1).max(25).parse(selectorsInput);
  if(new Set(selectors.map(s=>s.messageId)).size!==selectors.length)throw new AppError('INVALID_REQUEST');
  const binding=this.binding();const before=await this.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');await this.activeOwner(tx);return this.loadSources(tx,selectors);});
  const replies=z.array(bnaReceivedReply).max(250).parse(await reader.readRepliesForBinding(before.map(({messageId,inquiryId,program,providerId,recipient,acceptedAt})=>({messageId,inquiryId,program,providerId,recipient,acceptedAt})),{primaryMailbox:binding.primaryMailbox,monitorFrom:binding.monitorFrom}));
  if(new Set(replies.map(r=>r.providerMessageId)).size!==replies.length)throw new AppError('UNAVAILABLE');
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.activeOwner(tx);
   if(JSON.stringify(this.binding())!==JSON.stringify(binding))throw new AppError('UNAVAILABLE');
   const current=await this.loadSources(tx,selectors);if(JSON.stringify(current)!==JSON.stringify(before))throw new AppError('CONFLICT');
   let received=0,replayed=0;for(const reply of replies){
    const source=current.find(s=>s.messageId===reply.originalMessageId),now=this.clock.now();
    if(!source||reply.inquiryId!==source.inquiryId||reply.program!==source.program||Date.parse(reply.receivedAt)<Date.parse(binding.monitorFrom)||
     Date.parse(reply.receivedAt)<Date.parse(source.createdAt)||Date.parse(reply.receivedAt)>now.getTime())throw new AppError('UNAVAILABLE');
    const payload:z.infer<typeof receiptPayload>={version:1,provider:'gmail_metadata',mailboxKey:binding.mailboxKey,recipientKey:source.recipientKey,
     source:{kind:source.kind,messageId:source.messageId,providerId:source.providerId,createdAt:source.createdAt,acceptedAt:source.acceptedAt},reply};
    const messageKey=this.digest('bna-mailbox-provider-message/v1',{mailboxKey:binding.mailboxKey,id:reply.providerMessageId});
    const prior=await one<Receipt>(tx,`SELECT ${receiptColumns} FROM ls_service_interest.bna_mailbox_reply_receipts r WHERE r.workspace_id=$1 AND r.mailbox_key=$2 AND r.provider_message_key=$3`,[this.workspace,binding.mailboxKey,messageKey]);
    if(prior){if(JSON.stringify(this.decode(prior))!==JSON.stringify(payload))throw new AppError('CONFLICT');await this.review(tx,prior.id);replayed++;continue;}
    const id=randomUUID();await tx.query(`INSERT INTO ls_service_interest.bna_mailbox_reply_receipts(workspace_id,id,owner_account_id,mailbox_key,provider_message_key,recipient_key,inquiry_id,program_key,source_kind,source_message_id,received_at,recorded_at,payload_digest,payload_ciphertext)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[this.workspace,id,this.ownerId,binding.mailboxKey,messageKey,source.recipientKey,source.inquiryId,source.program,source.kind,source.messageId,reply.receivedAt,now,
     this.digest('bna-mailbox-receipt/v1',payload),seal(JSON.stringify(payload),this.receiptAad(id),this.ring)]);
    await this.append(tx,id,1,randomUUID(),null);received++;
   }
   const result={received,replayed};await onSaved?.(tx,result);return result;
  });
 }
 /** A paused monitor must still honor every unresolved receipt, including from
  * a prior mailbox binding. Reading this does not invent a preference event. */
 async pendingInTransaction(tx:SqlSession,recipientKey:string,program:BnaReceivedReply['program']){
  hash.parse(recipientKey);let pending=false;
  const rows=await tx.query<Joined>(`SELECT ${joinedColumns} FROM ls_service_interest.bna_mailbox_reply_receipts r ${latestReview} WHERE r.workspace_id=$1 AND r.owner_account_id=$2 AND r.recipient_key=$3 AND r.program_key=$4 ORDER BY r.received_at,r.id LIMIT 1001`,[this.workspace,this.ownerId,recipientKey,program]);
  if(rows.length>1000)throw new AppError('UNAVAILABLE');for(const row of rows){this.decode(row);const review=this.joinedReview(row);pending=review.state==='pending'||pending;}return pending;
 }
 private async inquiry(tx:SqlSession,id:string){if(!z.uuid().safeParse(id).success)throw new AppError('INVALID_REQUEST');
  if(!(await one(tx,"SELECT id FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND id=$2 AND owner_account_id=$3 AND program_key IN('bna_learning_coop','bna_support_interest')",[this.workspace,id,this.ownerId])))throw new AppError('NOT_FOUND');}
 async summariesForInquiries(actor:Actor,input:readonly string[]){const ids=z.array(z.uuid()).max(100).parse(input);
  if(new Set(ids).size!==ids.length)throw new AppError('INVALID_REQUEST');return this.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');await this.owner(tx,actor);
   const summary:Record<string,{pending:number;latestReceivedAt:string|null}>={};for(const id of ids)summary[id]={pending:0,latestReceivedAt:null};if(!ids.length)return summary;
   const owned=await tx.query<{id:string}>("SELECT id FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND owner_account_id=$2 AND id=ANY($3::uuid[])",[this.workspace,this.ownerId,ids]);
   if(owned.length!==ids.length)throw new AppError('NOT_FOUND');
   const rows=await tx.query<Joined>(`SELECT ${joinedColumns} FROM ls_service_interest.bna_mailbox_reply_receipts r ${latestReview} WHERE r.workspace_id=$1 AND r.owner_account_id=$2 AND r.inquiry_id=ANY($3::uuid[]) ORDER BY r.received_at,r.id LIMIT 10001`,[this.workspace,this.ownerId,ids]);
   if(rows.length>10000)throw new AppError('UNAVAILABLE');for(const row of rows){this.decode(row);const review=this.joinedReview(row),s=summary[row.inquiryId];if(!s)throw new AppError('UNAVAILABLE');
    if(review.state==='pending')s.pending++;s.latestReceivedAt=row.receivedAt.toISOString();}return summary;
  });
 }
 private cursorAad(inquiryId:string){return `ls_service_interest/bna-mailbox-reply-cursor/v1/${this.workspace}/${this.ownerId}/${inquiryId}`;}
 async readOwner(actor:Actor,inquiryId:string,before?:string){return this.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');await this.owner(tx,actor);await this.inquiry(tx,inquiryId);
  let anchor:string|null=null;if(before!==undefined){try{if(!/^[A-Za-z0-9_-]{64,2048}$/.test(before))throw Error();const bytes=Buffer.from(before,'base64url');if(bytes.toString('base64url')!==before)throw Error();
   anchor=z.strictObject({id:z.uuid()}).parse(JSON.parse(unseal(bytes.toString(),this.cursorAad(inquiryId),this.ring))).id;}catch{throw new AppError('INVALID_REQUEST');}
   if(!(await one(tx,'SELECT id FROM ls_service_interest.bna_mailbox_reply_receipts WHERE workspace_id=$1 AND inquiry_id=$2 AND id=$3',[this.workspace,inquiryId,anchor])))throw new AppError('INVALID_REQUEST');}
  const rows=await tx.query<Joined>(`SELECT ${joinedColumns} FROM ls_service_interest.bna_mailbox_reply_receipts r ${latestReview} WHERE r.workspace_id=$1 AND r.inquiry_id=$2 AND r.owner_account_id=$3
   AND ($4::uuid IS NULL OR (r.received_at,r.id)<(SELECT received_at,id FROM ls_service_interest.bna_mailbox_reply_receipts WHERE workspace_id=$1 AND id=$4 AND inquiry_id=$2)) ORDER BY r.received_at DESC,r.id DESC LIMIT 51`,[this.workspace,inquiryId,this.ownerId,anchor]);
  const items=[];for(const row of rows.slice(0,50)){const payload=this.decode(row),review=this.joinedReview(row);items.push({id:row.id,version:review.version,state:review.state,sourceKind:row.sourceKind,receivedAt:row.receivedAt.toISOString(),recordedAt:row.recordedAt.toISOString(),providerThreadId:payload.reply.providerThreadId});}
  return {inquiryId,items,nextCursor:rows.length>50?Buffer.from(seal(JSON.stringify({id:items.at(-1)!.id}),this.cursorAad(inquiryId),this.ring)).toString('base64url'):null};
 });}
 async markReviewed(actor:Actor,input:BnaReplyReviewCommand){const command=bnaReplyReviewCommand.parse(input);return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.owner(tx,actor);
  const row=await one<Receipt>(tx,`SELECT ${receiptColumns} FROM ls_service_interest.bna_mailbox_reply_receipts r WHERE r.workspace_id=$1 AND r.id=$2 AND r.owner_account_id=$3`,[this.workspace,command.receiptId,this.ownerId]);
  if(!row)throw new AppError('NOT_FOUND');this.decode(row);await this.inquiry(tx,row.inquiryId);const current=await this.review(tx,row.id);
  const prior=await one<Review>(tx,`SELECT ${reviewColumns} FROM ls_service_interest.bna_mailbox_reply_reviews e WHERE e.workspace_id=$1 AND e.operation_id=$2`,[this.workspace,command.operationId]);
  if(prior){const p=this.decodeReview(prior);if(p.source!=='owner'||p.receiptId!==command.receiptId||p.expectedVersion!==command.expectedVersion)throw new AppError('CONFLICT');return {state:current.state,version:current.version,replayed:true};}
  if(current.version!==command.expectedVersion||current.state!=='pending')throw new AppError('CONFLICT');
  await this.append(tx,row.id,2,command.operationId,actor.id);return {state:'reviewed' as const,version:2,replayed:false};
 });}
}
