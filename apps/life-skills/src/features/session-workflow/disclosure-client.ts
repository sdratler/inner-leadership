import {z} from "zod";
import {sessionCommand,sessionRead} from "./client.ts";
import {MAX_DISCLOSURE_RECORDS,disclosureSchema,disclosureInputSchema,disclosureReceiptSchema,disclosureRecordReadback,type DisclosureInput,type DisclosureView} from "./disclosure-contract.ts";
import type {CommandOutcome,CommandPort} from "../../ui/revamp/use-command.ts";
type Scope={workspaceId:string;caseId:string;sessionId:string};
export async function readDisclosures(scope:Scope,id?:string,signal?:AbortSignal):Promise<DisclosureView[]>{
 const raw=await sessionRead<unknown>(`/${scope.sessionId}/disclosures${id?"?"+new URLSearchParams({disclosureId:id}):""}`,signal),parsed=z.array(disclosureSchema).max(MAX_DISCLOSURE_RECORDS).safeParse(raw);
 if(!parsed.success||parsed.data.some(row=>row.workspaceId!==scope.workspaceId||row.caseId!==scope.caseId||row.sessionId!==scope.sessionId||id&&row.id!==id)||new Set(parsed.data.map(row=>row.id)).size!==parsed.data.length||id&&parsed.data.length!==1)throw Error("UNAVAILABLE");return parsed.data;
}
function verifiedPort<I>(scope:Scope,mode:"record"|"revoke"|"use",id?:string):CommandPort<I,DisclosureView>{
 const command=sessionCommand<I,unknown>(`/${scope.sessionId}/disclosures${id?`/${id}/${mode}`:""}`),attempts=new Map<string,{input:I;receipt:unknown;committed:boolean}>();
 async function settle(key:string,result:CommandOutcome<unknown>):Promise<CommandOutcome<DisclosureView>>{
  const attempt=attempts.get(key);if(!attempt)return {state:"rejected",message:"INVALID_REQUEST"};if(result.state==="rejected"){attempts.delete(key);return result;}if(result.state==="unknown")return result;
  attempt.receipt=result.value;attempt.committed=disclosureReceiptSchema.safeParse(result.value).success;
  try{const receipt=disclosureReceiptSchema.parse(result.value);if(id&&receipt.disclosureId!==id)throw Error("UNAVAILABLE");const saved=(await readDisclosures(scope,receipt.disclosureId))[0]!;
   if(mode==="record"?!disclosureRecordReadback(saved,attempt.input as DisclosureInput):mode==="use"?saved.usedAt===null||Date.parse(saved.usedAt)!==Date.parse((attempt.input as {usedAt:string}).usedAt)||saved.revokedAt!==null:saved.revokedAt!==receipt.revokedAt||saved.usedAt!==(attempt.input as {expectedUsedAt:string|null}).expectedUsedAt)throw Error("UNAVAILABLE");
   if(saved.revokedAt!==receipt.revokedAt||saved.usedAt!==receipt.usedAt)throw Error("UNAVAILABLE");attempts.delete(key);return {state:"accepted",value:saved};
  }catch{return {state:"unknown"};}
 }
 return {async execute(input,key){if(attempts.has(key))return {state:"rejected",message:"CONFLICT"};const parsed=mode==="record"?disclosureInputSchema.safeParse(input):{success:true,data:input};if(!parsed.success)return {state:"rejected",message:"INVALID_REQUEST"};const stable=structuredClone(parsed.data) as I;attempts.set(key,{input:stable,receipt:null,committed:false});return settle(key,await command.execute(stable,key));},async reconcile(key){const attempt=attempts.get(key);if(!attempt)return {state:"rejected",message:"INVALID_REQUEST"};return settle(key,attempt.committed?{state:"accepted",value:attempt.receipt}:await command.execute(attempt.input,key));}};
}
export const disclosureRecordPort=(scope:Scope)=>verifiedPort<DisclosureInput>(scope,"record");
export const disclosureRevokePort=(scope:Scope,id:string)=>verifiedPort<{expectedUsedAt:string|null}>(scope,"revoke",id);
export const disclosureUsePort=(scope:Scope,id:string)=>verifiedPort<{usedAt:string}>(scope,"use",id);
