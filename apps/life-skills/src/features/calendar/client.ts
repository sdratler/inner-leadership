import { sessionInfo, IdentityClientError } from '../identity/client.ts';
import type { ErrorCode, Envelope } from '../../lib/errors.ts';
export class CalendarClientError extends Error {readonly code:ErrorCode;constructor(code:ErrorCode){super(code);this.name='CalendarClientError';this.code=code;}}
export async function calendarRead<T>(path:string):Promise<T>{return request<T>(path,{method:'GET'});}
async function request<T>(path:string,options:RequestInit):Promise<T>{
 if(!/^[a-z0-9/?=&_%:.\-]+$/i.test(path)||path.includes('..')||path.startsWith('/'))throw new CalendarClientError('INVALID_REQUEST');
 let response:Response;
 try{response=await fetch('/api/calendar/'+path,{...options,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});}catch{throw new CalendarClientError('UNAVAILABLE');}
 let envelope:Envelope<T>;try{envelope=await response.json() as Envelope<T>;}catch{throw new CalendarClientError('UNAVAILABLE');}
 if(!envelope||typeof envelope!=='object'||!('ok' in envelope))throw new CalendarClientError('UNAVAILABLE');
 if(response.ok&&envelope.ok)return envelope.data;
 const codes=['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','CONFLICT','PAYLOAD_TOO_LARGE','UNSUPPORTED_MEDIA_TYPE','RATE_LIMITED','UNAVAILABLE','INTERNAL'];
 throw new CalendarClientError(!envelope.ok&&codes.includes(envelope.error?.code)?envelope.error.code:'UNAVAILABLE');
}
/** The caller retains this key in memory across uncertain retries. No browser persistence of client data. */
export async function calendarWrite<T>(path:string,body:unknown,key:string,method:'POST'|'PATCH'='POST'):Promise<T>{
 let csrf:string;try{csrf=(await sessionInfo()).csrfToken;}catch(e){throw new CalendarClientError(e instanceof IdentityClientError?e.code:'UNAVAILABLE');}
 return request<T>(path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key},body:JSON.stringify(body)});
}
