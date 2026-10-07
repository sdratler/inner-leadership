import "server-only";
import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { CONTENT_VOICE_FILE_ID, COMMUNITY_PLAYBOOK_FILE_ID } from "../content-voice/source.ts";
import type { CommunityReplyResult } from "./bridge.ts";
import { isCommunitySourceUrl } from "./input-state.ts";

const SCOUT_ORIGIN = "https://community-scout-production.up.railway.app";
const date=z.string().max(40).refine(value=>Number.isFinite(Date.parse(value)));
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const publicUrl=z.string().url().max(1000).refine(isCommunitySourceUrl).nullable();
const source=z.object({id:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),driveRevision:z.string().regex(/^[0-9]+$/),declaredVersion:z.string().max(40).nullable(),modifiedAt:date,checkedAt:date});
export const communityReplyResultSchema=z.object({operationId:z.string().uuid(),reply:z.string().min(10).max(3000),copyAllowed:z.boolean(),reviewFlags:z.array(z.string().max(100)).max(40),suggestedRule:z.string().max(400),ruleScope:z.enum(['','community','general']),originalUrl:publicUrl,
  provenance:z.object({guide:source.extend({id:z.literal(CONTENT_VOICE_FILE_ID),includedCommunityRuleIds:z.array(z.string().regex(/^CR-[a-f0-9]{32}$/)).max(250),includedGlobalRuleIds:z.array(z.string().regex(/^CR-[a-f0-9]{32}$/)).max(250).optional()}),playbook:source.extend({id:z.literal(COMMUNITY_PLAYBOOK_FILE_ID)}),policyVersion:z.string().min(1).max(100),generatedAt:date,model:z.string().min(1).max(100),usage:z.object({inputTokens:integer,outputTokens:integer})})});
const saved=z.object({draftId:z.string().uuid(),question:z.string().min(8).max(2000),originalUrl:publicUrl,generated:communityReplyResultSchema,draft:z.string().min(10).max(3000),revision:z.number().int().min(1).max(1000000),editedAt:date.nullable(),expiresAt:date,copyAllowed:z.boolean(),reviewFlags:z.array(z.string().max(100)).max(40)})
  .refine(value=>value.draftId===value.generated.operationId&&value.originalUrl===value.generated.originalUrl&&(!value.copyAllowed||(value.generated.copyAllowed&&value.reviewFlags.length===0)));
export type CommunitySavedDraft = z.infer<typeof saved> & { generated: CommunityReplyResult };
export type DraftEdit = {operationId:string;draftId:string;expectedRevision:number;draft:string};

async function exchange(ownerId:string,path:string,method:'GET'|'PUT',command:DraftEdit|undefined,fetcher:typeof fetch,env:Record<string,string|undefined>):Promise<unknown>{
  if(!z.string().uuid().safeParse(ownerId).success||!env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET||! /^[A-Za-z0-9_-]{43,}$/.test(env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET))throw new AppError('UNAVAILABLE');
  const secret=env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET;
  let response:Response;
  try{response=await fetcher(SCOUT_ORIGIN+path,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000),headers:{Authorization:`Bearer ${secret}`,...(method==='PUT'?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify({...command,ownerId})}:{})});}
  catch{throw new AppError('UNAVAILABLE');}
  if(response.status===404)throw new AppError('NOT_FOUND');
  if(response.status===409)throw new AppError('CONFLICT');
  if(!response.ok)throw new AppError('UNAVAILABLE');
  let body:unknown;
  try{if(!response.body)throw Error('body');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>1_000_000){await reader.cancel();throw Error('envelope');}chunks.push(chunk.value);}}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{throw new AppError('UNAVAILABLE');}
  if(!body||typeof body!=='object'||(body as {ok?:unknown}).ok!==true)throw new AppError('UNAVAILABLE');
  return (body as {data?:unknown}).data;
}
export async function readCommunityDrafts(ownerId:string,draftId?:string,fetcher:typeof fetch=fetch,env:Record<string,string|undefined>=process.env):Promise<{drafts:CommunitySavedDraft[];limit:20}>{
  if(draftId!==undefined&&!z.string().uuid().safeParse(draftId).success)throw new AppError('NOT_FOUND');
  const params=new URLSearchParams({ownerId,...(draftId?{draftId}:{})});
  const parsed=z.object({drafts:z.array(saved).max(20),limit:z.literal(20)}).safeParse(await exchange(ownerId,'/internal/life-skills/drafts?'+params,'GET',undefined,fetcher,env));
  if(!parsed.success||new Set(parsed.data.drafts.map(value=>value.draftId)).size!==parsed.data.drafts.length||(draftId&&(parsed.data.drafts.length!==1||parsed.data.drafts[0]!.draftId!==draftId)))throw new AppError('UNAVAILABLE');
  return parsed.data as {drafts:CommunitySavedDraft[];limit:20};
}
export async function saveCommunityDraft(ownerId:string,command:DraftEdit,fetcher:typeof fetch=fetch,env:Record<string,string|undefined>=process.env):Promise<CommunitySavedDraft>{
  const parsed=saved.safeParse(await exchange(ownerId,'/internal/life-skills/drafts','PUT',command,fetcher,env));
  if(!parsed.success||parsed.data.draftId!==command.draftId||parsed.data.revision!==command.expectedRevision+1||parsed.data.draft!==command.draft)throw new AppError('UNAVAILABLE');
  return parsed.data as CommunitySavedDraft;
}
