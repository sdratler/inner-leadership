import { AppError } from "../../lib/errors.ts";
import type { AuthEmailMessage,AuthEmailTransport } from "./transport.ts";
import { AuthEmailDeliveryError } from "./transport.ts";
const ADDRESS=/^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/;
export interface ResendAuthConfig {apiKey:string;from:string;enabled:boolean;}
export function parseResendAuthConfig(env:Record<string,string|undefined>):ResendAuthConfig {
 if(env.LS_AUTH_EMAIL_ENABLED!=='true' || !env.RESEND_API_KEY || !/^re_[A-Za-z0-9_\-]{10,200}$/.test(env.RESEND_API_KEY) || !env.LS_AUTH_EMAIL_FROM || !ADDRESS.test(env.LS_AUTH_EMAIL_FROM) || env.LS_AUTH_EMAIL_FROM.length>254) throw new AppError("UNAVAILABLE");
 return {enabled:true,apiKey:env.RESEND_API_KEY,from:env.LS_AUTH_EMAIL_FROM};
}
export class ResendAuthTransport implements AuthEmailTransport {
 constructor(private readonly config:ResendAuthConfig,private readonly sendFetch:typeof fetch=fetch){}
 async send(message:AuthEmailMessage):Promise<{providerId:string}> {
  if(!this.config.enabled || message.from!==this.config.from || !ADDRESS.test(message.to) || message.to.length>254 || !/^ls-auth-[0-9a-f-]{36}$/.test(message.idempotencyKey) || /[\r\n]/.test(message.subject) || message.subject.length>150 || message.text.length>5000) throw new AuthEmailDeliveryError(false);
  let response:Response;
  try{response=await this.sendFetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${this.config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':message.idempotencyKey},body:JSON.stringify({from:message.from,to:[message.to],subject:message.subject,text:message.text})});}
  catch{throw new AuthEmailDeliveryError(true);}
  if(!response.ok){await response.body?.cancel();throw new AuthEmailDeliveryError(response.status===429 || response.status>=500 || response.status===409);}
  const reader=response.body?.getReader();if(!reader) throw new AuthEmailDeliveryError(true);
  let size=0,text='';const decoder=new TextDecoder();
  try{while(true){const piece=await reader.read();if(piece.done) break;size+=piece.value.length;if(size>4096){await reader.cancel();throw new Error();}text+=decoder.decode(piece.value,{stream:true});}text+=decoder.decode();}
  catch{throw new AuthEmailDeliveryError(true);}finally{reader.releaseLock();}
  try{const data:unknown=JSON.parse(text);if(!data || typeof data!=='object' || !('id' in data) || typeof data.id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) throw new Error();return {providerId:data.id};}
  catch{throw new AuthEmailDeliveryError(true);}
 }
}
