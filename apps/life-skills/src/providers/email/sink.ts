import { AppError } from "../../lib/errors.ts";
import type { AuthEmailMessage,AuthEmailTransport } from "./transport.ts";
/** Synthetic tests only. Never instantiate as a production fallback or write contents to logs. */
export class SyntheticAuthEmailSink implements AuthEmailTransport {
 readonly messages:AuthEmailMessage[]=[];
 constructor(mode:'synthetic-test'){if(mode!=='synthetic-test') throw new AppError("UNAVAILABLE");}
 async send(message:AuthEmailMessage){
  if(!message.to.endsWith('@example.invalid') || !message.from.endsWith('@example.invalid')) throw new AppError("FORBIDDEN");
  const index=this.messages.findIndex(x=>x.idempotencyKey===message.idempotencyKey);
  if(index>=0){if(JSON.stringify(this.messages[index])!==JSON.stringify(message)) throw new AppError("CONFLICT");return {providerId:`synthetic-${index}`};}
  this.messages.push({...message});return {providerId:`synthetic-${this.messages.length-1}`};
 }
 clear():void{this.messages.splice(0);}
}
