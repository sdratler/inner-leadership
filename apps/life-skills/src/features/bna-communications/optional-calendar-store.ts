import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {Actor,IdentityClock} from '../identity/types.ts';
import type {BnaInquiryStore} from '../bna-inquiry/store.ts';
import type {BnaPreferenceStore} from './preferences-store.ts';
import {bnaEmailRecipientKey} from './acknowledgment-store.ts';
import {bnaEmailCandidates,previewBnaEmailCandidate} from './email-candidates.ts';
import {BNA_EMAIL_SENDER,BNA_EMAIL_SOURCE,decideBnaEducationalDelivery} from './delivery-policy.ts';
import {bnaOptionalCommand,bnaOptionalPrepare,bnaOptionalTemplate,type BnaOptionalCommand,type BnaOptionalPrepare,type BnaOptionalState,type BnaOptionalTemplate} from './optional-calendar-contract.ts';
import {bnaNativeReplySource} from './reply-contract.ts';

const tracks={bna_learning_coop:['EMAIL-B1','EMAIL-B2','EMAIL-B3','EMAIL-B4','EMAIL-B5'],bna_support_interest:['EMAIL-S1','EMAIL-S2','EMAIL-S3']} as const;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const frozenSchema=z.strictObject({version:z.literal(1),inquiryId:z.uuid(),templateId:bnaOptionalTemplate,locale:z.enum(['en','he']),recipient:z.email(),
 subject:z.string().min(1).max(150),text:z.string().min(1).max(15000),from:z.literal(BNA_EMAIL_SENDER),replyTo:z.literal(BNA_EMAIL_SENDER),
 postalAddress:z.string().min(12).max(500),sourceSha256:z.literal(BNA_EMAIL_SOURCE),copySha256:z.string().regex(/^[a-f0-9]{64}$/)});
type Frozen=z.infer<typeof frozenSchema>;
/** Protected, server-owned review facts. No environment-only transport is
 * mounted here. The production admission/worker needs separate exact-target
 * release and provider acceptance; a synthetic test callback is not authority. */
export type BnaOptionalAdmission={sourceSha256:typeof BNA_EMAIL_SOURCE;postalAddress:string;approvedCopies:Readonly<Record<string,string>>};
export interface BnaOptionalTransport{
 authorize(message:{id:string;payload:Frozen}):boolean;
 send(message:{id:string;payload:Frozen}):Promise<{state:'accepted';providerId:string}|{state:'not_attempted'}|{state:'unknown'}>;
}
type Message={id:string;operationId:string;inquiryId:string;ownerAccountId:string;recipientKey:string;programKey:keyof typeof tracks;
 templateId:BnaOptionalTemplate;locale:'en'|'he';preferenceVersion:number;permissionAt:Date;createdAt:Date;sourceSha256:string;copySha256:string;commandDigest:string;payloadDigest:string;ciphertext:string};
type Event={messageId:string;version:number;operationId:string;actorAccountId:string|null;state:BnaOptionalState;code:string;recordedAt:Date;reservedAt:Date|null;providerId:string|null;commandDigest:string};
type Item=Message&{event:Event};
const messageColumns=`id,operation_id AS "operationId",inquiry_id AS "inquiryId",owner_account_id AS "ownerAccountId",recipient_key AS "recipientKey",program_key AS "programKey",template_id AS "templateId",locale,preference_version AS "preferenceVersion",permission_at AS "permissionAt",created_at AS "createdAt",source_sha256 AS "sourceSha256",copy_sha256 AS "copySha256",command_digest AS "commandDigest",payload_digest AS "payloadDigest",payload_ciphertext AS ciphertext`;
const eventColumns=`message_id AS "messageId",version,operation_id AS "operationId",actor_account_id AS "actorAccountId",state,code,recorded_at AS "recordedAt",reserved_at AS "reservedAt",provider_id AS "providerId",command_digest AS "commandDigest"`;
export class BnaOptionalCalendarStore{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ownerId:string,private readonly ring:Keyring,
  private readonly key:string,private readonly clock:IdentityClock,private readonly inquiries:Pick<BnaInquiryStore,'optionalEmailContext'>,
  private readonly preferences:Pick<BnaPreferenceStore,'readForCalendar'|'capabilityForCalendar'>,private readonly admission:()=>BnaOptionalAdmission|null=()=>null){}
 private aad(id:string){return `ls_service_interest/bna-optional-message/v1/${this.workspace}/${id}`;}
 private digest(domain:string,value:unknown){return privateDigest({domain,workspace:this.workspace,value},this.key);}
 private async owner(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.workspace||actor.id!==this.ownerId)throw new AppError('NOT_FOUND');
  const fresh=await freshActor(tx,actor,this.clock.now());if(fresh.role!=='practitioner'||fresh.id!==this.ownerId||fresh.state!=='active')throw new AppError('NOT_FOUND');
 }
 private copy(id:BnaOptionalTemplate){const copy=bnaEmailCandidates.messages.find(row=>row.id===id);
  if(!copy||bnaEmailCandidates.sourceSha256!==BNA_EMAIL_SOURCE||hash(JSON.stringify(copy.content))!==copy.copySha256)throw new AppError('UNAVAILABLE');return copy;}
 private admitted(id:BnaOptionalTemplate){const a=this.admission(),copy=this.copy(id);
  if(!a||a.sourceSha256!==BNA_EMAIL_SOURCE||a.approvedCopies[id]!==copy.copySha256||a.postalAddress.trim().length<12||a.postalAddress.length>500||/[\r\n{}<>]/.test(a.postalAddress))return null;return a;
 }
 private decode(row:Message){try{const p=frozenSchema.parse(JSON.parse(unseal(row.ciphertext,this.aad(row.id),this.ring)));
  if(row.ownerAccountId!==this.ownerId||p.inquiryId!==row.inquiryId||p.templateId!==row.templateId||p.locale!==row.locale||p.sourceSha256!==row.sourceSha256||p.copySha256!==row.copySha256||
   this.digest('bna-optional-payload/v1',p)!==row.payloadDigest||bnaEmailRecipientKey(this.workspace,p.recipient,this.key)!==row.recipientKey||!tracks[row.programKey].some(id=>id===p.templateId))throw Error();return p;
 }catch{throw new AppError('UNAVAILABLE');}}
 private async rows(tx:SqlSession,recipientKey:string){
  const messages=await tx.query<Message>(`SELECT ${messageColumns} FROM ls_service_interest.bna_optional_messages WHERE workspace_id=$1 AND recipient_key=$2 ORDER BY created_at,id LIMIT 2001`,[this.workspace,recipientKey]);
  if(messages.length>2000)throw new AppError('UNAVAILABLE');
  const events=await tx.query<Event>(`SELECT DISTINCT ON(e.message_id) ${eventColumns.split(',').map(c=>'e.'+c.trim()).join(',')} FROM ls_service_interest.bna_optional_events e
   JOIN ls_service_interest.bna_optional_messages m ON m.workspace_id=e.workspace_id AND m.id=e.message_id WHERE e.workspace_id=$1 AND m.recipient_key=$2 ORDER BY e.message_id,e.version DESC`,[this.workspace,recipientKey]);
  const byId=new Map(events.map(e=>[e.messageId,e]));return messages.map(row=>{this.decode(row);const event=byId.get(row.id);
   if(!event||event.recordedAt>this.clock.now()||event.recordedAt<row.createdAt||row.permissionAt>row.createdAt)throw new AppError('UNAVAILABLE');return {...row,event};});
 }
 private async context(tx:SqlSession,inquiryId:string){
  const [c,p]=await Promise.all([this.inquiries.optionalEmailContext(tx,inquiryId),this.preferences.readForCalendar(tx,inquiryId)]);
  if(c.recipient!==p.context.recipient||c.program!==p.preferences.program)throw new AppError('UNAVAILABLE');return {...c,...p};
 }
 /** Server-internal known-send binding, including a late provider acceptance.
  * The monitor receives the adult recipient and identifiers, never the email. */
 async replySource(tx:SqlSession,id:string){
  if(!z.uuid().safeParse(id).success)throw new AppError('INVALID_REQUEST');
  const item=await this.item(tx,id),payload=this.decode(item);
  if(item.event.state!=='sent'||!item.event.providerId||item.event.recordedAt>this.clock.now()||
   !['PROVIDER_ACCEPTED','PROVIDER_ACCEPTED_AFTER_CANCEL'].includes(item.event.code))throw new AppError('UNAVAILABLE');
  return bnaNativeReplySource.parse({kind:'optional',messageId:item.id,inquiryId:item.inquiryId,program:item.programKey,
   providerId:item.event.providerId,recipient:payload.recipient,recipientKey:item.recipientKey,createdAt:item.createdAt.toISOString(),acceptedAt:item.event.recordedAt.toISOString()});
 }
 private next(context:Awaited<ReturnType<BnaOptionalCalendarStore['context']>>,rows:Item[]){
  return tracks[context.program].find(id=>!rows.some(row=>row.templateId===id&&row.event.state==='sent'))??null;
 }
 private decision(context:Awaited<ReturnType<BnaOptionalCalendarStore['context']>>,rows:Item[],id:BnaOptionalTemplate,excluding?:string){
  const p=context.preferences,copy=this.copy(id),others=rows.filter(row=>row.id!==excluding);
  const decision=decideBnaEducationalDelivery({templateId:id,now:this.clock.now(),permissionGrantedAt:p.permissionGrantedAt?new Date(p.permissionGrantedAt):null,
   withdrawn:p.withdrawn,paused:p.paused,replyPending:p.replyPending,closed:context.closed,invalidRecipient:p.invalidRecipient,complaint:p.complaint,
   unknownDelivery:others.some(row=>['unknown','canceled_unknown'].includes(row.event.state)),
   identicalContentSent:others.some(row=>row.event.state==='sent'&&(row.templateId===id||row.copySha256===copy.copySha256)),
   educationalSentAt:others.filter(row=>row.event.state==='sent').map(row=>row.event.recordedAt)});
  if(!decision.eligible)return decision;
  if(this.next(context,rows)!==id)return {eligible:false as const,reason:'sequence_order' as const};
  if(others.some(row=>row.templateId===id&&['prepared','failed'].includes(row.event.state)))return {eligible:false as const,reason:'already_prepared' as const};
  return decision;
 }
 private preview(context:Awaited<ReturnType<BnaOptionalCalendarStore['context']>>,id:BnaOptionalTemplate){
  const name=/[\r\n]|\{\{|\}\}/.test(context.adultName)?'':context.adultName;
  return previewBnaEmailCandidate(id,context.preferences.locale,{FIRST_NAME:name,REFERENCE:context.inquiryId,
   ARTICLES_URL:'https://bneineviimacademy.org'+(context.preferences.locale==='he'?'/he/blog':'/blog'),SUPPORT_URL:'https://bneineviimacademy.org'+(context.preferences.locale==='he'?'/he/support':'/support'),
   PREFERENCES_URL:'https://bneineviimacademy.org'+(context.preferences.locale==='he'?'/he/email-preferences':'/email-preferences')});
 }
 async readOwner(actor:Actor,inquiryId:string){return this.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');await this.owner(tx,actor);
  const context=await this.context(tx,inquiryId),rows=await this.rows(tx,context.context.recipientKey),id=this.next(context,rows);
  const prepared=id?[...rows].reverse().find(row=>row.templateId===id&&!['sent','canceled'].includes(row.event.state)):undefined;
  const frozen=prepared?this.decode(prepared):null;
  const preview=id?this.preview(context,id):null;
  return {next:id&&preview?{...preview,...(frozen?{subject:frozen.subject,body:frozen.text.replace(/#token=[A-Za-z0-9_-]{100,2048}/g,'#token=[protected recipient link]'),locale:frozen.locale,copySha256:frozen.copySha256}:{}),
    decision:this.decision(context,rows,id),canPrepare:!!this.admitted(id),frozen:!!frozen,messageId:prepared?.id??null,personalLinkBoundOnPrepare:!frozen}:null,
   preferenceVersion:context.preferences.version,sendingEnabled:false as const,
   history:rows.slice(-50).reverse().map(row=>({id:row.id,inquiryId:row.inquiryId,program:row.programKey,templateId:row.templateId,locale:row.locale,
    state:row.event.state,version:row.event.version,code:row.event.code,recordedAt:row.event.recordedAt.toISOString()})),hasMoreHistory:rows.length>50};
 });}
 private async append(tx:SqlSession,item:Message,previous:Event|null,state:BnaOptionalState,code:string,operationId:string,commandDigest:string,actorId:string|null=null,providerId:string|null=null){
  const now=this.clock.now(),version=(previous?.version??0)+1,reservedAt=state==='prepared'?null:code==='DELIVERY_RESERVED'?now:previous?.reservedAt??null;
  await tx.query(`INSERT INTO ls_service_interest.bna_optional_events(workspace_id,message_id,version,operation_id,actor_account_id,state,code,recorded_at,reserved_at,provider_id,command_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[this.workspace,item.id,version,operationId,actorId,state,code,now,reservedAt,providerId,commandDigest]);
 }
 async prepare(actor:Actor,input:BnaOptionalPrepare){const command=bnaOptionalPrepare.parse(input),digest=this.digest('bna-optional-prepare/v1',{actor:actor.id,command});
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.owner(tx,actor);
   const prior=await one<Message>(tx,`SELECT ${messageColumns} FROM ls_service_interest.bna_optional_messages WHERE workspace_id=$1 AND operation_id=$2`,[this.workspace,command.operationId]);
   if(prior){if(prior.commandDigest!==digest||prior.ownerAccountId!==this.ownerId)throw new AppError('CONFLICT');this.decode(prior);return {messageId:prior.id,replayed:true};}
   const context=await this.context(tx,command.inquiryId),rows=await this.rows(tx,context.context.recipientKey),a=this.admitted(command.templateId);
   if(!a)throw new AppError('UNAVAILABLE');if(context.preferences.version!==command.expectedPreferenceVersion)throw new AppError('CONFLICT');
   const decision=this.decision(context,rows,command.templateId);if(!decision.eligible)return {blocked:decision,replayed:false};
   const token=await this.preferences.capabilityForCalendar(tx,command.inquiryId),url='https://bneineviimacademy.org'+(context.preferences.locale==='he'?'/he/email-preferences':'/email-preferences')+'#token='+token;
   const preview=this.preview(context,command.templateId),id=randomUUID(),now=this.clock.now();
   const payload=frozenSchema.parse({version:1,inquiryId:context.inquiryId,templateId:command.templateId,locale:context.preferences.locale,recipient:context.recipient,
    subject:preview.subject,text:preview.body+'\n\nBnei Neviim Academy\n'+(context.preferences.locale==='he'?'העדפות דוא״ל: ':'Email preferences: ')+url+'\n'+BNA_EMAIL_SENDER+'\n'+a.postalAddress.trim(),from:BNA_EMAIL_SENDER,replyTo:BNA_EMAIL_SENDER,postalAddress:a.postalAddress.trim(),sourceSha256:BNA_EMAIL_SOURCE,copySha256:preview.copySha256});
   const item:Message={id,operationId:command.operationId,inquiryId:context.inquiryId,ownerAccountId:this.ownerId,recipientKey:context.context.recipientKey,programKey:context.program,templateId:command.templateId,locale:payload.locale,
    preferenceVersion:context.preferences.version,permissionAt:new Date(context.preferences.permissionGrantedAt!),createdAt:now,sourceSha256:BNA_EMAIL_SOURCE,copySha256:payload.copySha256,commandDigest:digest,payloadDigest:this.digest('bna-optional-payload/v1',payload),ciphertext:seal(JSON.stringify(payload),this.aad(id),this.ring)};
   await tx.query(`INSERT INTO ls_service_interest.bna_optional_messages(workspace_id,id,operation_id,inquiry_id,owner_account_id,recipient_key,program_key,template_id,locale,preference_version,permission_at,created_at,source_sha256,copy_sha256,command_digest,payload_digest,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[this.workspace,id,command.operationId,item.inquiryId,this.ownerId,item.recipientKey,item.programKey,item.templateId,item.locale,item.preferenceVersion,item.permissionAt,now,item.sourceSha256,item.copySha256,digest,item.payloadDigest,item.ciphertext]);
   await this.append(tx,item,null,'prepared','PREPARED',command.operationId,digest,actor.id);return {messageId:id,replayed:false};
  });
 }
 private async item(tx:SqlSession,id:string){const row=await one<Message>(tx,`SELECT ${messageColumns} FROM ls_service_interest.bna_optional_messages WHERE workspace_id=$1 AND id=$2 AND owner_account_id=$3`,[this.workspace,id,this.ownerId]);if(!row)throw new AppError('NOT_FOUND');
  const items=await this.rows(tx,row.recipientKey),item=items.find(i=>i.id===id);if(!item)throw new AppError('UNAVAILABLE');return item;}
 async command(actor:Actor,input:BnaOptionalCommand){const command=bnaOptionalCommand.parse(input),digest=this.digest('bna-optional-command/v1',{actor:actor.id,command});
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.owner(tx,actor);const item=await this.item(tx,command.messageId);
   const prior=await one<Event>(tx,`SELECT ${eventColumns} FROM ls_service_interest.bna_optional_events WHERE workspace_id=$1 AND operation_id=$2`,[this.workspace,command.operationId]);
   if(prior){if(prior.messageId!==item.id||prior.commandDigest!==digest)throw new AppError('CONFLICT');return {state:item.event.state,replayed:true};}
   if(item.event.version!==command.expectedVersion)throw new AppError('CONFLICT');
   if(command.action==='retry_not_attempted'){
    if(item.event.state!=='failed'||item.event.code!=='PROVIDER_NOT_ATTEMPTED')throw new AppError('CONFLICT');
    await this.append(tx,item,item.event,'prepared','OWNER_RETRY_NOT_ATTEMPTED',command.operationId,digest,actor.id);return {state:'prepared' as const,replayed:false};
   }
   if(!['prepared','unknown','failed'].includes(item.event.state))throw new AppError('CONFLICT');
   const state=item.event.state==='unknown'?'canceled_unknown':'canceled';
   await this.append(tx,item,item.event,state,state==='canceled_unknown'?'OWNER_CANCELED_UNCONFIRMED':'OWNER_CANCELED',command.operationId,digest,actor.id);return {state,replayed:false};
  });
 }
 /** UNKNOWN is committed before calling a server-owned adapter. A second
  * program/worker sees it under the same workspace lock and cannot send. */
 async dispatch(id:string,transport:BnaOptionalTransport){
  const reserved=await this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);const item=await this.item(tx,id),payload=this.decode(item);
   if(item.event.state!=='prepared')return {state:item.event.state};const a=this.admitted(item.templateId);
   if(!a||a.approvedCopies[item.templateId]!==item.copySha256||a.postalAddress.trim()!==payload.postalAddress||!transport.authorize({id,payload}))return {state:'prepared' as const};
   const context=await this.context(tx,item.inquiryId),rows=await this.rows(tx,item.recipientKey);
   if(context.context.recipientKey!==item.recipientKey||context.preferences.locale!==item.locale||context.preferences.permissionGrantedAt!==item.permissionAt.toISOString())return {state:'prepared' as const};
   if(!this.decision(context,rows,item.templateId,id).eligible)return {state:'prepared' as const};
   await this.append(tx,item,item.event,'unknown','DELIVERY_RESERVED',randomUUID(),this.digest('bna-optional-reserve/v1',{id,version:item.event.version}));return {payload};
  });
  if(!reserved.payload)return reserved.state;
  const payload=reserved.payload;
  let result:Awaited<ReturnType<BnaOptionalTransport['send']>>={state:'unknown'};
  try{
   const fresh=await this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);const item=await this.item(tx,id),a=this.admitted(item.templateId);
    if(item.event.state!=='unknown'||!a||a.approvedCopies[item.templateId]!==item.copySha256||a.postalAddress.trim()!==payload.postalAddress)return false;
    const context=await this.context(tx,item.inquiryId),rows=await this.rows(tx,item.recipientKey);
    return context.context.recipientKey===item.recipientKey&&context.preferences.locale===item.locale&&
     context.preferences.permissionGrantedAt===item.permissionAt.toISOString()&&this.decision(context,rows,item.templateId,id).eligible;
   });
   if(fresh&&transport.authorize({id,payload}))result=await transport.send({id,payload});else result={state:'not_attempted'};
  }catch{/* uncertain effect stays reserved */}
  if(result.state==='unknown'||result.state==='accepted'&&!/^[A-Za-z0-9_-]{1,256}$/.test(result.providerId))return 'unknown' as const;
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);const item=await this.item(tx,id);if(!['unknown','canceled_unknown'].includes(item.event.state))throw new AppError('CONFLICT');
   const canceled=item.event.state==='canceled_unknown',state=result.state==='accepted'?'sent':canceled?'canceled':'failed';
   const code=result.state==='accepted'?(canceled?'PROVIDER_ACCEPTED_AFTER_CANCEL':'PROVIDER_ACCEPTED'):(canceled?'CANCELED_PROVIDER_NOT_ATTEMPTED':'PROVIDER_NOT_ATTEMPTED');
   await this.append(tx,item,item.event,state,code,randomUUID(),this.digest('bna-optional-complete/v1',{id,result}),null,result.state==='accepted'?result.providerId:null);return state;
  });
 }
}
