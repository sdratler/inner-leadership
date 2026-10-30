import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {GmailAuthConfig} from '../../providers/email/gmail.ts';
import {BNA_EMAIL_SENDER,bnaEmailProgram} from './delivery-policy.ts';

const id=z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const address=z.email().max(254).refine(x=>/^[\x21-\x7e]+$/.test(x));
const sentSchema=z.strictObject({messageId:z.uuid(),inquiryId:z.uuid(),program:bnaEmailProgram,
 providerId:id,recipient:address,acceptedAt:z.iso.datetime()});
export type BnaSentReplySource=z.infer<typeof sentSchema>;
export type BnaReceivedReply={inquiryId:string;program:BnaSentReplySource['program'];originalMessageId:string;
 providerMessageId:string;providerThreadId:string;receivedAt:string};
const header=z.strictObject({name:z.string().min(1).max(100),value:z.string().max(8192)});
const metadata=z.strictObject({id,threadId:id,internalDate:z.string().regex(/^\d{1,16}$/),
 labelIds:z.array(z.string().max(100)).max(100).default([]),payload:z.strictObject({headers:z.array(header).max(100)})});
type Metadata=z.infer<typeof metadata>;
const thread=z.strictObject({id,messages:z.array(metadata).min(1).max(100)});
const HEADERS=['From','To','Message-ID','In-Reply-To','References','Reply-To','Auto-Submitted','X-Autoreply','X-Autorespond','Precedence','List-Id'];
const FIELDS='id,threadId,internalDate,labelIds,payload/headers';
const READ_SCOPES=new Set(['https://www.googleapis.com/auth/gmail.metadata','https://www.googleapis.com/auth/gmail.readonly',
 'https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/']);
const unavailable=()=>new AppError('UNAVAILABLE');
function singleHeader(message:Metadata,name:string){
 const values=message.payload.headers.filter(h=>h.name.toLowerCase()===name.toLowerCase());
 if(values.length>1)throw unavailable();return values[0]?.value.trim()??'';
}
function mailbox(value:string){
 const match=/^(?:[^<>\r\n]*<([^<>\r\n]+)>|([^<>\r\n]+))$/.exec(value);
 const parsed=address.safeParse((match?.[1]??match?.[2]??'').trim());
 return parsed.success?parsed.data.toLowerCase():null;
}
function addressedTo(value:string,expected:string){
 const parts:string[]=[];let part='',quoted=false,escaped=false,angle=false;
 for(const character of value){
  if(/[\r\n]/.test(character))return false;
  if(escaped){part+=character;escaped=false;continue;}
  if(character==='\\'&&quoted){part+=character;escaped=true;continue;}
  if(character==='"')quoted=!quoted;
  if(!quoted&&character==='<'){if(angle)return false;angle=true;}
  if(!quoted&&character==='>'){if(!angle)return false;angle=false;}
  if(character===','&&!quoted&&!angle){parts.push(part);part='';}else part+=character;
 }
 if(quoted||escaped||angle)return false;parts.push(part);
 const parsed=parts.map(x=>mailbox(x.trim()));return parsed.every(x=>x!==null)&&parsed.includes(expected);
}
function referenceIds(value:string){
 // Accept only complete RFC message-id tokens separated by whitespace. Do not
 // infer a relationship from a subject, snippet, display name or copied text.
 const tokens=value.match(/<[^<>\s]{1,300}>/g)??[];
 if(value.replace(/<[^<>\s]{1,300}>/g,'').trim())throw unavailable();
 return tokens;
}
function nativeReferences(message:Metadata){
 const native=(x:string)=>/^<ls-auth-[0-9a-f-]{36}@bneineviimacademy\.org>$/.test(x);
 const refs=referenceIds(singleHeader(message,'References')).filter(native),direct=referenceIds(singleHeader(message,'In-Reply-To')).filter(native);
 if(new Set(direct).size>1||(direct.length&&refs.length&&direct.at(-1)!==refs.at(-1)))throw unavailable();
 return [...refs,...direct];
}
function receivedAt(message:Metadata,now:Date){
 const ms=Number(message.internalDate);if(!Number.isSafeInteger(ms)||ms<=0||ms>now.getTime()+300000)throw unavailable();
 return new Date(ms).toISOString();
}
function automatic(message:Metadata){
 const submitted=singleHeader(message,'Auto-Submitted').toLowerCase();
 return (!!submitted&&submitted!=='no')||!!singleHeader(message,'X-Autoreply')||!!singleHeader(message,'X-Autorespond')||
  !!singleHeader(message,'List-Id')||/^(?:bulk|list|junk)$/i.test(singleHeader(message,'Precedence'));
}
async function boundedJson(response:Response,maxBytes:number){
 if(!response.ok){await response.body?.cancel();throw unavailable();}
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes)){await response.body?.cancel();throw unavailable();}
 const reader=response.body?.getReader();if(!reader)throw unavailable();let length=0;const chunks:Uint8Array[]=[];
 try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;
   if(length>maxBytes){await reader.cancel();throw unavailable();}chunks.push(next.value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
 }catch{throw unavailable();}finally{reader.releaseLock();}
}

/** Read only known BNA send threads with Gmail METADATA. Never scans the inbox,
 * requests bodies/subjects/snippets, changes labels, sends, or expands OAuth.
 * The native caller must supply frozen, provider-accepted send bindings and
 * persist these receipts transactionally before advancing its monitoring state.
 * A received reply is evidence for owner review, never an opt-in or auto-reply.
 */
export class BnaGmailReplyReader{
 constructor(private readonly config:GmailAuthConfig,private readonly primaryMailbox:string,private readonly monitorFrom:string,
  private readonly clock:{now:()=>Date},private readonly readFetch:typeof fetch=fetch){}
 async readReplies(input:readonly BnaSentReplySource[]):Promise<BnaReceivedReply[]>{
  try{return await this.read(input);}catch{throw unavailable();}
 }
 private async read(input:readonly BnaSentReplySource[]){
  const sources=z.array(sentSchema).max(25).parse(input),primary=address.parse(this.primaryMailbox).toLowerCase();
  const cutoff=z.iso.datetime().parse(this.monitorFrom),now=this.clock.now();
  if(!Number.isFinite(now.getTime())||Date.parse(cutoff)>now.getTime()||!this.config.enabled||this.config.from!==BNA_EMAIL_SENDER)throw unavailable();
  if(new Set(sources.map(s=>s.messageId)).size!==sources.length||new Set(sources.map(s=>s.providerId)).size!==sources.length||
   sources.some(s=>Date.parse(s.acceptedAt)>now.getTime()))throw unavailable();
  if(!sources.length)return [];
  const authorization=z.object({access_token:z.string().min(1).max(4096).refine(x=>!/[\r\n]/.test(x)),scope:z.string().max(8192).optional()}).parse(
   await boundedJson(await this.readFetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.config.clientId,client_secret:this.config.clientSecret,
     refresh_token:this.config.refreshToken,grant_type:'refresh_token'}).toString()}),16384));
  // A refresh reuses the existing grant. Never request another scope or reuse
  // the send-only credential as evidence that mailbox monitoring works.
  if(authorization.scope!==undefined&&!authorization.scope.split(' ').some(s=>READ_SCOPES.has(s)))throw unavailable();
  const get=async(path:string,maxBytes:number)=>boundedJson(await this.readFetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,
   {method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+authorization.access_token}}),maxBytes);
  const profile=z.strictObject({emailAddress:address}).parse(await get('profile?fields=emailAddress',16384));
  if(profile.emailAddress.toLowerCase()!==primary)throw unavailable();
  const params=new URLSearchParams({format:'metadata',fields:FIELDS});for(const name of HEADERS)params.append('metadataHeaders',name);
  const threadParams=new URLSearchParams({format:'metadata',fields:'id,messages('+FIELDS+')'});for(const name of HEADERS)threadParams.append('metadataHeaders',name);
  const threads=new Map<string,z.infer<typeof thread>>(),found=new Map<string,BnaReceivedReply>();
  for(const source of sources){
   const original=metadata.parse(await get('messages/'+encodeURIComponent(source.providerId)+'?'+params,32768));
   const expected=`<ls-auth-${source.messageId}@bneineviimacademy.org>`,replyTo=singleHeader(original,'Reply-To');
   if(original.id!==source.providerId||!original.labelIds.includes('SENT')||original.labelIds.includes('DRAFT')||
    mailbox(singleHeader(original,'From'))!==BNA_EMAIL_SENDER||mailbox(singleHeader(original,'To'))!==source.recipient.toLowerCase()||
    singleHeader(original,'Message-ID')!==expected||(replyTo&&mailbox(replyTo)!==BNA_EMAIL_SENDER))throw unavailable();
   receivedAt(original,now);
   let messages=threads.get(original.threadId);if(!messages){messages=thread.parse(await get('threads/'+encodeURIComponent(original.threadId)+'?'+threadParams,262144));
    if(messages.id!==original.threadId||new Set(messages.messages.map(m=>m.id)).size!==messages.messages.length||
     messages.messages.some(m=>m.threadId!==original.threadId)||!messages.messages.some(m=>m.id===original.id))throw unavailable();
    threads.set(original.threadId,messages);}
   // Bind the thread's copy as well: a mismatched provider response must not
   // establish correlation or cause partial native effects.
   const echoed=messages.messages.find(m=>m.id===original.id)!;
   if(singleHeader(echoed,'Message-ID')!==expected||mailbox(singleHeader(echoed,'From'))!==BNA_EMAIL_SENDER||
    mailbox(singleHeader(echoed,'To'))!==source.recipient.toLowerCase()||echoed.internalDate!==original.internalDate||!echoed.labelIds.includes('SENT'))throw unavailable();
   for(const message of messages.messages){
    if(message.id===original.id||message.labelIds.some(l=>['SENT','DRAFT','SPAM','TRASH'].includes(l)))continue;
    if(mailbox(singleHeader(message,'From'))!==source.recipient.toLowerCase()||!addressedTo(singleHeader(message,'To'),BNA_EMAIL_SENDER)||automatic(message))continue;
    if(nativeReferences(message).at(-1)!==expected)continue;
    const time=receivedAt(message,now);if(Date.parse(time)<Date.parse(cutoff)||Date.parse(time)<Number(original.internalDate))continue;
    const ownReference=referenceIds(singleHeader(message,'Message-ID'));
    if(ownReference.length!==1||/^<ls-auth-/.test(ownReference[0]!))throw unavailable();
    const reply:BnaReceivedReply={inquiryId:source.inquiryId,program:source.program,originalMessageId:source.messageId,
     providerMessageId:message.id,providerThreadId:message.threadId,receivedAt:time};
    const prior=found.get(message.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(reply))throw unavailable();found.set(message.id,reply);
   }
  }
  return [...found.values()].sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.providerMessageId.localeCompare(b.providerMessageId));
 }
}
