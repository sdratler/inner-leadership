import catalog from './academy-inquiry-email-control-copy.json' with {type:'json'};
import type {academyMetadata} from './academy-metadata.ts';

export const INQUIRY_EMAIL_CONTROL_COPY_VERSION='JLFA-INQUIRY-EMAIL-CONTROL-COPY-20261109-v1' as const;
export const INQUIRY_EMAIL_CONTROL_PURPOSE='fishing_inquiry_email_control_v1' as const;
export const INQUIRY_EMAIL_CONTROL_VERSION='JLFA-INQUIRY-EMAIL-CONTROL-v1' as const;
export const INQUIRY_EMAIL_CONTROL_FRAGMENT='email-control.v1.' as const;
export const INQUIRY_EMAIL_CONTROL_PATH='/confirm-interest' as const;
export function inquiryEmailControlCopy(locale:'en'|'he'){
 if(catalog.version!==INQUIRY_EMAIL_CONTROL_COPY_VERSION)throw Error('INQUIRY_EMAIL_CONTROL_COPY_VERSION');
 return catalog.locales[locale];
}
export function isInquiryEmailControlMode(value:unknown){return value==='v1';}
/** Presentation only: the server page owns mode admission and the HTTP
 * endpoint independently owns purpose and authorization. Preserve historical
 * metadata outside the exact mailbox-confirmation query mode. */
export function inquiryEmailControlPresentationMetadata(base:ReturnType<typeof academyMetadata>,locale:'en'|'he',path:string,search:string):ReturnType<typeof academyMetadata>{
 const values=new URLSearchParams(search).getAll('email_control');
 if(path!==INQUIRY_EMAIL_CONTROL_PATH||values.length!==1||!isInquiryEmailControlMode(values[0]))return base;
 const copy=inquiryEmailControlCopy(locale);
 return {...base,title:copy.heading,description:copy.intro,openGraph:{...base.openGraph,title:copy.heading,description:copy.intro},twitter:{...base.twitter,title:copy.heading,description:copy.intro}};
}
export function inquiryEmailControlToken(fragment:string):string|null{
 const match=/^#email-control\.v1\.([A-Za-z0-9_-]{43})$/.exec(fragment);return match?.[1]??null;
}
/** HTTP success, legacy founder flags and unknown shapes never imply proof. */
export function inquiryEmailControlResult(value:unknown):'confirmed'|'already_used'|'not_available'|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const body=value as Record<string,unknown>;
 if(Object.keys(body).sort().join(',')!=='data,ok,requestId'||body.ok!==true||typeof body.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)||!body.data||typeof body.data!=='object'||Array.isArray(body.data))return null;
 const data=body.data as Record<string,unknown>;
 if(Object.keys(data).join(',')!=='state')return null;
 return data.state==='confirmed'||data.state==='already_used'||data.state==='not_available'?data.state:null;
}

/** One deliberate POST, including body read, bounded by15s/16KiB. No retries.
 * External abort is reserved for unmount; an internal timeout leaves callers'
 * bearer intact so they can offer an explicit retry with honest uncertainty. */
export async function submitInquiryEmailControl(token:string,signal?:AbortSignal){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('INVALID_CONFIRMATION_TOKEN');
 if(signal?.aborted)throw new DOMException('Request aborted','AbortError');
 const controller=new AbortController(),bodyState:{reader:ReadableStreamDefaultReader<Uint8Array>|null;complete:boolean}={reader:null,complete:false};
 let rejectStop:(reason:Error)=>void=()=>{};
 const stopped=new Promise<never>((_resolve,reject)=>{rejectStop=reject;});
 const onAbort=()=>{controller.abort();rejectStop(new DOMException('Request aborted','AbortError'));};
 signal?.addEventListener('abort',onAbort,{once:true});
 const timer=setTimeout(()=>{controller.abort();rejectStop(Error('CONFIRMATION_RESULT_UNKNOWN'));},15_000);
 try{
  return await Promise.race([stopped,(async()=>{
   const response=await fetch('/api/public/academy-founder',{method:'POST',redirect:'error',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'confirm_inquiry_email',purpose:INQUIRY_EMAIL_CONTROL_PURPOSE,version:INQUIRY_EMAIL_CONTROL_VERSION,token})});
   // A custom/late fetch may resolve after the race already timed out. Do not
   // acquire a reader after outer cleanup has completed.
   if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('CONFIRMATION_RESULT_UNKNOWN');}
   if(!response.ok||response.redirected||!response.body)throw Error('CONFIRMATION_RESULT_UNKNOWN');
   const reader=response.body.getReader();bodyState.reader=reader;const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
   while(true){
    const next=await reader.read();if(next.done){bodyState.complete=true;break;}
    size+=next.value.byteLength;if(size>16_384)throw Error('CONFIRMATION_RESULT_UNKNOWN');
    text+=decoder.decode(next.value,{stream:true});
   }
   text+=decoder.decode();const result=inquiryEmailControlResult(JSON.parse(text));
   if(!result)throw Error('CONFIRMATION_RESULT_UNKNOWN');return result;
  })()]);
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort();
  const reader=bodyState.reader;
  if(reader){if(!bodyState.complete)void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
 }
}
