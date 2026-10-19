import {z} from "zod";
import {sessionInfo,IdentityClientError} from "../../identity/client.ts";
import {fishingProgramSchema} from "./fishing-association-contract.ts";
import {fishingLeadRequestSchema,fishingMembershipSchema,fishingLabelProjectionSchema,fishingLeadResultSchema,fishingLeadDetailsSchema,
 type FishingLeadRequest} from "./fishing-lead.ts";

const uuid=z.string().uuid(),epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
export const fishingLeadContextSchema=z.discriminatedUnion("state",[
 z.object({state:z.literal("ready"),epoch,personId:uuid.nullable(),membership:fishingMembershipSchema.nullable(),projection:fishingLabelProjectionSchema.nullable()}).strict(),
 z.object({state:z.literal("blocked"),epoch,reason:z.enum(["native_authority_required","email_only","identity","reserved"]),
  choices:z.array(z.object({personId:uuid,name:z.string().min(1).max(1000)}).strict()).max(20)}).strict(),
]);
export const fishingLeadPreviewSchema=z.discriminatedUnion("state",[
 z.object({state:z.literal("ready"),token:z.string().min(50).max(16000),operationId:uuid,name:z.string().min(1).max(1000),phone:z.string().nullable(),
  personId:uuid.nullable(),newPerson:z.boolean(),action:z.enum(["add","remove","edit"]),details:fishingLeadDetailsSchema.optional(),expectedVersion:z.number().int().min(0),expiresAt:z.iso.datetime()}).strict()
  .refine(v=>v.newPerson===(v.personId===null)&&(!v.newPerson||v.action==="add"&&v.expectedVersion===0)&&(v.action==="edit"?v.details!==undefined:v.details===undefined)),
 z.object({state:z.literal("clarify"),reason:z.enum(["email_only","identity","reserved"]),
  choices:z.array(z.object({personId:uuid,name:z.string().min(1).max(1000)}).strict()).max(20)}).strict(),
]);
export type FishingLeadContext=z.infer<typeof fishingLeadContextSchema>;
export type FishingLeadPreview=z.infer<typeof fishingLeadPreviewSchema>;
export type FishingLeadProgram=z.infer<typeof fishingProgramSchema>;
export type FishingLeadSource={kind:"person"|"inquiry";id:string};
export class FishingLeadClientError extends Error{
 constructor(readonly status:number){super("FISHING_LEAD_REQUEST_FAILED");}
}
async function request(path:string,input?:FishingLeadRequest):Promise<unknown>{
 try{
  const headers:Record<string,string>={};
  if(input){const session=await sessionInfo();if(session.role!=="practitioner")throw new FishingLeadClientError(403);
   headers["content-type"]="application/json";headers["x-csrf-token"]=session.csrfToken;}
  const r=await fetch(path,{method:input?"POST":"GET",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",
   headers,...(input?{body:JSON.stringify(fishingLeadRequestSchema.parse(input))}:{})});
  if(!r.ok)throw new FishingLeadClientError(r.status);
  const b=await r.json();if(!b?.ok||!b.data)throw new FishingLeadClientError(503);return b.data;
 }catch(e){if(e instanceof FishingLeadClientError)throw e;
  if(e instanceof IdentityClientError&&e.code==="UNAUTHENTICATED")throw new FishingLeadClientError(401);
  if(e instanceof IdentityClientError&&e.code==="FORBIDDEN")throw new FishingLeadClientError(403);
  throw new FishingLeadClientError(503);}
}
const path=(program:FishingLeadProgram)=>"/api/private/fishing-leads/"+fishingProgramSchema.parse(program);
export async function readFishingLeadContext(program:FishingLeadProgram,source:FishingLeadSource):Promise<FishingLeadContext>{
 const data=fishingLeadContextSchema.parse(await request(path(program)+"?"+new URLSearchParams({source:source.kind,sourceId:uuid.parse(source.id)})));
 if(data.state==="ready"){
  const m=data.membership,p=data.projection;
  if(source.kind==="person"&&data.personId!==source.id||m&&(m.personId!==data.personId||m.program!==program)||
   p&&(!m||p.personId!==m.personId||p.workspaceId!==m.workspaceId||p.program!==program||p.generation!==m.version||p.desiredPresent!==(m.state==="active")))
   throw new FishingLeadClientError(503);
 }
 return data;
}
export async function previewFishingLead(program:FishingLeadProgram,input:Exclude<FishingLeadRequest,{action:"confirm"}>):Promise<FishingLeadPreview>{
 const data=fishingLeadPreviewSchema.parse(await request(path(program),input));
 if(data.state==="ready"&&(data.operationId!==input.operationId||data.expectedVersion!==input.expectedAssociationVersion||
  data.action!==(input.action==="preview_add"?"add":input.action==="preview_remove"?"remove":"edit")||
  input.action==="preview_edit"&&JSON.stringify(data.details)!==JSON.stringify(fishingLeadDetailsSchema.parse(input.details))||
  (input.action!=="preview_add"?data.personId!==input.personId:
   input.source.kind==="person"?data.personId!==input.source.id:input.selectedPersonId!==undefined&&data.personId!==input.selectedPersonId)))
  throw new FishingLeadClientError(503);
 return data;
}
export async function confirmFishingLead(program:FishingLeadProgram,input:Extract<FishingLeadRequest,{action:"confirm"}>,
 preview:Extract<FishingLeadPreview,{state:"ready"}>,expectedEpoch:number){
 const result=fishingLeadResultSchema.parse(await request(path(program),input));
 if(result.program!==program||result.operationId!==preview.operationId||result.authorityEpoch!==expectedEpoch||
  result.version!==preview.expectedVersion+1||result.newPerson!==preview.newPerson||result.state!==(preview.action==="remove"?"removed":"active")||
  preview.personId!==null&&result.personId!==preview.personId)throw new FishingLeadClientError(503);
 return result;
}
