import {randomUUID} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {BnaGmailReplyReader,type BnaSentReplySource} from '../../src/features/bna-communications/gmail-reply-reader.ts';
const config={enabled:true as const,clientId:'SYNTHETIC_CLIENT',clientSecret:'SYNTHETIC_SECRET',refreshToken:'SYNTHETIC_REFRESH',from:'office@bneineviimacademy.org' as const};
const now=new Date('2026-10-30T12:00:00Z'),cutoff='2026-10-30T10:00:00Z',primary='synthetic-owner@example.invalid';
const source=():BnaSentReplySource=>({messageId:randomUUID(),inquiryId:randomUUID(),program:'bna_learning_coop',providerId:'sent001',recipient:'adult@example.invalid',acceptedAt:'2026-10-30T10:30:00Z'});
const rfc=(s:BnaSentReplySource)=>`<ls-auth-${s.messageId}@bneineviimacademy.org>`;
const msg=(s:BnaSentReplySource,own=false)=>({id:own?s.providerId:'reply001',threadId:'thread001',internalDate:String(Date.parse(own?s.acceptedAt:'2026-10-30T11:00:00Z')),labelIds:own?['SENT']:['INBOX','UNREAD'],payload:{headers:[
 {name:'From',value:own?config.from:s.recipient},{name:'To',value:own?s.recipient:config.from},
 {name:'Message-ID',value:own?rfc(s):'<reply-one@example.invalid>'},...(own?[]:[{name:'In-Reply-To',value:rfc(s)}])]}});
type Msg=ReturnType<typeof msg>;
function changeHeader(m:Msg,name:string,value:string){m.payload.headers=m.payload.headers.filter(h=>h.name!==name);m.payload.headers.push({name,value});}
function fixture(s=source(),mutate?:(own:Msg,replies:Msg[])=>void,scope='https://www.googleapis.com/auth/gmail.metadata'){
 const own=msg(s,true),replies=[msg(s)];mutate?.(own,replies);const calls:{url:string;method:string;body:unknown}[]=[];
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const u=String(url);calls.push({url:u,method:init?.method??'GET',body:init?.body});
  if(u==='https://oauth2.googleapis.com/token')return Response.json({access_token:'SYNTHETIC_ACCESS',scope});
  if(u.includes('/profile?'))return Response.json({emailAddress:primary});
  if(u.includes('/messages/'))return Response.json(own);
  if(u.includes('/threads/'))return Response.json({id:own.threadId,messages:[own,...replies]});
  throw Error('unexpected endpoint');
 });
 return {s,own,replies,calls,fetcher,reader:new BnaGmailReplyReader(config,primary,cutoff,{now:()=>now},fetcher as typeof fetch)};
}
describe('known-send Gmail metadata reply reader',()=>{
 it('reads only the accepted-send thread, returns identifiers only, and never marks or sends mail',async()=>{
  const f=fixture(),replies=await f.reader.readReplies([f.s]);
  expect(replies).toEqual([{inquiryId:f.s.inquiryId,program:f.s.program,originalMessageId:f.s.messageId,providerMessageId:'reply001',providerThreadId:'thread001',receivedAt:'2026-10-30T11:00:00.000Z'}]);
  expect(JSON.stringify(replies)).not.toMatch(/adult@|synthetic-owner|SYNTHETIC_|headers|subject|snippet|payload|text/);
  expect(f.calls.map(c=>c.method)).toEqual(['POST','GET','GET','GET']);
  expect(f.calls[0]!.body).not.toMatch(/scope=/);
  for(const call of f.calls.slice(1)){expect(call.body).toBeUndefined();expect(call.url).not.toMatch(/\/send|\/modify|[?&]q=|format=(?:full|raw)|snippet|subject/i);}
  for(const call of f.calls.slice(2)){const u=new URL(call.url);expect(u.searchParams.get('format')).toBe('metadata');expect(u.searchParams.getAll('metadataHeaders')).toContain('In-Reply-To');}
 });
 it('refuses the actual send-only capability before any profile/message request',async()=>{
  const f=fixture(undefined,undefined,'https://www.googleapis.com/auth/gmail.send');
  await expect(f.reader.readReplies([f.s])).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(1);
 });
 it('verifies primary mailbox rather than equating an Office send alias with inbox ownership',async()=>{
  const f=fixture();const reader=new BnaGmailReplyReader(config,'another@example.invalid',cutoff,{now:()=>now},f.fetcher as typeof fetch);
  await expect(reader.readReplies([f.s])).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(2);
 });
 it('binds the native ingestion admission to this reader before requesting any provider data',async()=>{
  const f=fixture();await expect(f.reader.readRepliesForBinding([f.s],{primaryMailbox:'wrong@example.invalid',monitorFrom:cutoff})).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect(f.calls).toHaveLength(0);expect(await f.reader.readRepliesForBinding([f.s],{primaryMailbox:primary,monitorFrom:cutoff})).toHaveLength(1);
 });
 it.each(['From','To','Message-ID'])('rejects a mismatched original %s binding',async name=>{
  const f=fixture(undefined,own=>changeHeader(own,name,'wrong@example.invalid'));
  await expect(f.reader.readReplies([f.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('requires the sent provider record and rejects a foreign reply-to alias',async()=>{
  const f=fixture(undefined,own=>{own.labelIds=['INBOX'];});await expect(f.reader.readReplies([f.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
  const g=fixture(undefined,own=>changeHeader(own,'Reply-To','other@example.invalid'));await expect(g.reader.readReplies([g.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('accepts a named parent and quoted/multiple To mailboxes without using display names as identity',async()=>{
  const f=fixture(undefined,(_own,[reply])=>{changeHeader(reply!,'From','"Synthetic, Adult" <ADULT@example.invalid>');changeHeader(reply!,'To','"BNA, Office" <office@bneineviimacademy.org>, other@example.invalid');});
  expect(await f.reader.readReplies([f.s])).toHaveLength(1);
 });
 it.each(['From','To'])('ignores a reply with a different %s address even when its subject/thread could match',async name=>{
  const f=fixture(undefined,(_own,[reply])=>changeHeader(reply!,name,'unrelated@example.invalid'));expect(await f.reader.readReplies([f.s])).toEqual([]);
 });
 it.each(['SENT','DRAFT','SPAM','TRASH'])('ignores %s messages',async label=>{
  const f=fixture(undefined,(_own,[reply])=>{reply!.labelIds=[label];});expect(await f.reader.readReplies([f.s])).toEqual([]);
 });
 it.each([['Auto-Submitted','auto-replied'],['X-Autoreply','yes'],['X-Autorespond','yes'],['Precedence','bulk'],['List-Id','synthetic-list']])('ignores automatic/list message %s',async(name,value)=>{
  const f=fixture(undefined,(_own,[reply])=>changeHeader(reply!,name,value));expect(await f.reader.readReplies([f.s])).toEqual([]);
 });
 it('keeps a human Auto-Submitted:no reply and follows References across a manual conversation',async()=>{
  const f=fixture();changeHeader(f.replies[0]!,'Auto-Submitted','no');changeHeader(f.replies[0]!,'In-Reply-To','<manual-owner@example.invalid>');
  changeHeader(f.replies[0]!,'References',`${rfc(f.s)} <manual-owner@example.invalid>`);
  expect(await f.reader.readReplies([f.s])).toHaveLength(1);
 });
 it('attributes the closest native reference and does not attach another program reply to an older message',async()=>{
  const f=fixture(),other=source();changeHeader(f.replies[0]!,'References',`${rfc(f.s)} ${rfc(other)}`);changeHeader(f.replies[0]!,'In-Reply-To','<manual-parent@example.invalid>');
  expect(await f.reader.readReplies([f.s])).toEqual([]);
 });
 it('rejects conflicting native parent references rather than choosing a program arbitrarily',async()=>{
  const f=fixture();changeHeader(f.replies[0]!,'References',rfc(source()));
  await expect(f.reader.readReplies([f.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('rejects an inbound message that claims the reserved outbound message-id namespace',async()=>{
  const f=fixture();changeHeader(f.replies[0]!,'Message-ID',rfc(f.s));
  await expect(f.reader.readReplies([f.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('does not backfill replies before monitoring or before the original send',async()=>{
  const f=fixture(undefined,(_own,[reply])=>{reply!.internalDate=String(Date.parse('2026-10-29T11:00:00Z'));});expect(await f.reader.readReplies([f.s])).toEqual([]);
 });
 it('fails closed on duplicate identity headers, duplicate thread messages or forged future receipt time',async()=>{
  const f=fixture(undefined,(_own,[reply])=>reply!.payload.headers.push({name:'From',value:'second@example.invalid'}));await expect(f.reader.readReplies([f.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
  const g=fixture(undefined,(_own,replies)=>replies.push(structuredClone(replies[0]!)));await expect(g.reader.readReplies([g.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
  const h=fixture(undefined,(_own,[reply])=>{reply!.internalDate=String(now.getTime()+600000);});await expect(h.reader.readReplies([h.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('rejects body/snippet data rather than returning or accepting it as a metadata proof',async()=>{
  const f=fixture();Object.assign(f.replies[0]!,{snippet:'DO NOT COPY CHILD NOTE'});await expect(f.reader.readReplies([f.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('bounds input and response size, does no work for no sends, and returns no partial batch on a failure',async()=>{
  const f=fixture();expect(await f.reader.readReplies([])).toEqual([]);expect(f.calls).toHaveLength(0);
  await expect(f.reader.readReplies(Array.from({length:26},()=>source()))).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(0);
  const fetcher=vi.fn(async()=>new Response('x'.repeat(17000)));const reader=new BnaGmailReplyReader(config,primary,cutoff,{now:()=>now},fetcher as typeof fetch);
  await expect(reader.readReplies([f.s])).rejects.toMatchObject({code:'UNAVAILABLE'});
  const g=fixture(),second={...source(),providerId:'different'};await expect(g.reader.readReplies([g.s,second])).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('does not expose a provider error, OAuth token or raw response through failures',async()=>{
  const read=vi.fn(async()=>{throw Error('SYNTHETIC_REFRESH_DO_NOT_LOG');});const reader=new BnaGmailReplyReader(config,primary,cutoff,{now:()=>now},read as typeof fetch);
  await expect(reader.readReplies([source()])).rejects.toMatchObject({code:'UNAVAILABLE'});
  try{await reader.readReplies([source()]);}catch(e){expect(String(e)).not.toMatch(/SYNTHETIC_REFRESH/);}
 });
});
