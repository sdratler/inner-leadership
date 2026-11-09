import {randomUUID,createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {academy650AckContent} from '../../src/features/group-application/academy650-r2-ack.ts';
import {successResponse} from '../../src/lib/http/json.ts';
import {academyMetadata} from '../../src/features/group-application/academy-metadata.ts';
import {emailControlContent} from '../../src/features/group-application/academy-inquiry-email-control-email.ts';
import {inquiryEmailControlCopy,inquiryEmailControlToken,inquiryEmailControlResult,isInquiryEmailControlMode,INQUIRY_EMAIL_CONTROL_COPY_VERSION,INQUIRY_EMAIL_CONTROL_PATH,submitInquiryEmailControl} from '../../src/features/group-application/academy-inquiry-email-control-copy.ts';

const token='s'.repeat(43),input={reference:randomUUID(),parentFirstName:'Synthetic',children:[{id:randomUUID(),name:'Synthetic boy'},{id:randomUUID(),name:'Second boy'}],messageLanguage:'en' as const};
const requestId=randomUUID();
describe('confirmation component metadata route contract',()=>{
 it('uses the admitted metadata path in both locales while query selection remains outside the frame',()=>{
  for(const locale of ['en','he'] as const){const metadata=academyMetadata(locale,INQUIRY_EMAIL_CONTROL_PATH,undefined,'bna');expect(metadata.alternates.canonical).toBe('https://bneineviimacademy.org'+(locale==='he'?'/he':'')+'/fishing-academy/confirm-interest');}
 });
});
describe('prospective inquiry email control content',()=>{
 for(const messageLanguage of ['en','he'] as const)for(const parentFirstName of ['Synthetic',null])it(`${messageLanguage} preserves original R2 paragraphs/children/reference/greeting/closing (${parentFirstName})`,()=>{
  const raw={...input,messageLanguage,parentFirstName},original=academy650AckContent(raw),result=emailControlContent({...raw,token}),copy=inquiryEmailControlCopy(messageLanguage);
  for(const paragraph of original.text.split('\n\n'))expect(result.text).toContain(paragraph);
  for(const paragraph of original.html.match(/<p>[\s\S]*?<\/p>/g)??[])expect(result.html).toContain(paragraph);
  expect(result.version).toBe(INQUIRY_EMAIL_CONTROL_COPY_VERSION);expect(result.subject).toBe(copy.emailSubject);
  expect(result.text).toContain(copy.verificationPrompt);expect(result.html).toContain(copy.action);expect(result.text).toContain(copy.ignore);
  const url='https://bneineviimacademy.org/'+(messageLanguage==='he'?'he/':'')+'fishing-academy/confirm-interest?email_control=v1#email-control.v1.'+token;
  expect(result.text).toContain(url);expect(result.html).toContain('href="'+url+'"');expect(result.html).toContain('lang="'+messageLanguage+'" dir="'+(messageLanguage==='he'?'rtl':'ltr')+'"');
  expect(result.contentSha256).toBe(createHash('sha256').update(JSON.stringify({subject:result.subject,text:result.text,html:result.html}),'utf8').digest('hex'));
  expect(academy650AckContent(raw)).toEqual(original);expect(original.text).not.toContain(token);expect(original.html).not.toContain('email_control');
 });
 it('escapes hostile display names without interpreting inserted placeholders or dollar signs',()=>{
  const result=emailControlContent({...input,parentFirstName:'<img src=x onerror=alert(1)>',children:[{id:randomUUID(),name:'A & <b> {{parentFirstName}} $&'}],token});
  expect(result.html).toContain('&lt;img src=x onerror=alert(1)&gt;');expect(result.html).toContain('A &amp; &lt;b&gt; {{parentFirstName}} $&');expect(result.html).not.toContain('<img');expect(result.html).not.toContain('<b>');
 });
 it.each(['',token.slice(1),token+'a','<script>'.padEnd(43,'a'),'a'.repeat(42)+'\n','https://example.invalid'])('rejects an invalid token before building a URL %#',invalid=>{
  expect(()=>emailControlContent({...input,token:invalid})).toThrow();
 });
 it('retains existing R2 input integrity rather than accepting duplicate children, bad names or browser overrides',()=>{
  for(const raw of [{...input,token,children:[input.children[0],input.children[0]]},{...input,token,parentFirstName:'x\nInjected'},{...input,token,messageLanguage:'fr'},{...input,token,baseUrl:'https://attacker.invalid'}])expect(()=>emailControlContent(raw)).toThrow();
 });
});

describe('bounded inquiry confirmation transport',()=>{
 afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
 it('ends a deferred fetch at15s, rejects redirects by configuration and keeps the same bearer for a deliberate retry',async()=>{
  vi.useFakeTimers();const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValueOnce(successResponse({state:'confirmed'},requestId));vi.stubGlobal('fetch',fetcher);
  const first=submitInquiryEmailControl(token),rejection=expect(first).rejects.toThrow('CONFIRMATION_RESULT_UNKNOWN');await vi.advanceTimersByTimeAsync(15_000);await rejection;
  expect(fetcher).toHaveBeenCalledTimes(1);const initial=fetcher.mock.calls[0]![1];expect(initial).toMatchObject({method:'POST',redirect:'error',cache:'no-store',credentials:'same-origin'});expect(initial.signal.aborted).toBe(true);
  expect(await submitInquiryEmailControl(token)).toBe('confirmed');expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1]![1].body).toBe(initial.body);expect(vi.getTimerCount()).toBe(0);
 });
 it('bounds a hanging response body and releases its reader without an automatic retry',async()=>{
  vi.useFakeTimers();const cancel=vi.fn(),body=new ReadableStream<Uint8Array>({cancel}),fetcher=vi.fn().mockResolvedValue(new Response(body));vi.stubGlobal('fetch',fetcher);
  const result=submitInquiryEmailControl(token),rejection=expect(result).rejects.toThrow('CONFIRMATION_RESULT_UNKNOWN');await vi.advanceTimersByTimeAsync(15_000);await rejection;
  expect(cancel).toHaveBeenCalledTimes(1);expect(body.locked).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it('cancels a late fetch response after the deadline without acquiring a leaked body reader',async()=>{
  vi.useFakeTimers();let release:(value:Response)=>void=()=>{};const deferred=new Promise<Response>(resolve=>{release=resolve;}),cancel=vi.fn(),body=new ReadableStream<Uint8Array>({cancel});vi.stubGlobal('fetch',vi.fn().mockReturnValue(deferred));
  const result=submitInquiryEmailControl(token),rejection=expect(result).rejects.toThrow('CONFIRMATION_RESULT_UNKNOWN');await vi.advanceTimersByTimeAsync(15_000);await rejection;
  release(new Response(body));await vi.advanceTimersByTimeAsync(0);expect(cancel).toHaveBeenCalledTimes(1);expect(body.locked).toBe(false);
 });
 it('honors unmount abort and removes the timer/reader even when fetch ignores its signal',async()=>{
  vi.useFakeTimers();const body=new ReadableStream<Uint8Array>(),fetcher=vi.fn().mockResolvedValue(new Response(body)),external=new AbortController();vi.stubGlobal('fetch',fetcher);
  const result=submitInquiryEmailControl(token,external.signal),rejection=expect(result).rejects.toMatchObject({name:'AbortError'});await vi.advanceTimersByTimeAsync(0);external.abort();await rejection;
  expect(body.locked).toBe(false);expect(vi.getTimerCount()).toBe(0);
 });
 it('rejects a body over16KiB and releases the reader',async()=>{
  const response=new Response('x'.repeat(16_385));vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));await expect(submitInquiryEmailControl(token)).rejects.toThrow('CONFIRMATION_RESULT_UNKNOWN');expect(response.body!.locked).toBe(false);
 });
 it('rejects redirected/invalid/ambiguous responses rather than fabricating verification',async()=>{
  for(const response of [new Response('not-json'),new Response(JSON.stringify({ok:true,data:{confirmed:true}})),new Response('{}',{status:503})]){
   vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));await expect(submitInquiryEmailControl(token)).rejects.toThrow();
  }
  const redirected=new Response(JSON.stringify({ok:true,data:{state:'confirmed'},requestId}));Object.defineProperty(redirected,'redirected',{value:true});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(redirected));await expect(submitInquiryEmailControl(token)).rejects.toThrow('CONFIRMATION_RESULT_UNKNOWN');
 });
});
describe('browser-safe explicit email action boundaries',()=>{
 it('accepts only the exact query mode and namespaced full fragment, not founder bearers or arrays',()=>{
  expect(isInquiryEmailControlMode('v1')).toBe(true);for(const value of [undefined,null,['v1'],'v2','V1',1,{},'v1&other'])expect(isInquiryEmailControlMode(value)).toBe(false);
  expect(inquiryEmailControlToken('#email-control.v1.'+token)).toBe(token);
  for(const fragment of ['#'+token,'email-control.v1.'+token,'#email-control.v2.'+token,'#email-control.v1.'+token+'x','#email-control.v1.'+token+'\n','#email-control.v1.'+token+'?email=x','#email-control.v1.%73'+token.slice(1)])expect(inquiryEmailControlToken(fragment)).toBeNull();
 });
 it('requires exact explicit server evidence; HTTP success or old founder flags cannot become email verification',async()=>{
  for(const state of ['confirmed','already_used','not_available'] as const)expect(inquiryEmailControlResult(await successResponse({state},requestId).json())).toBe(state);
  for(const result of [null,[],true,{}, {ok:true}, {ok:true,data:{confirmed:true},requestId},{ok:true,data:{state:'already_confirmed'},requestId},{ok:false,data:{state:'confirmed'},requestId},{ok:'true',data:{state:'confirmed'},requestId},{ok:true,data:{state:'confirmed',guardian:true},requestId},{ok:true,data:{state:'confirmed'},requestId,verified:true},{ok:true,data:[],requestId},{ok:true,data:{state:'queued'},requestId},{ok:true,data:{state:'confirmed'}},...['',null,1,'not-a-uuid',requestId+'x'].map(bad=>({ok:true,data:{state:'confirmed'},requestId:bad}))])expect(inquiryEmailControlResult(result)).toBeNull();
 });
});
