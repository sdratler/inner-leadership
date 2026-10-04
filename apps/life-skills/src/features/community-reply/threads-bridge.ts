import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {instant} from '../../lib/time.ts';
const origin='https://community-scout-production.up.railway.app';
const date=z.string().max(40).transform((value,context):string=>{
 try{return instant(value);}catch{context.addIssue({code:'custom',message:'Expected an offset-qualified instant'});return z.NEVER;}
});
const commentId=z.string().regex(/^[0-9]{1,100}$/);
export function commentLink(value:string):{postUrl:string;commentId:string;rootCommentId:string;url:string}|null{
 let u:URL;try{u=new URL(value);}catch{return null;}
 if(value!==value.trim()||value.length>1000||u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!['facebook.com','www.facebook.com','m.facebook.com'].includes(u.hostname))return null;
 const path=u.pathname.match(/^\/groups\/([A-Za-z0-9_.-]{1,100})\/(?:posts|permalink)\/([A-Za-z0-9_-]{1,200})\/?$/),root=u.searchParams.get('comment_id'),reply=u.searchParams.get('reply_comment_id');
 if(!path||!root||!commentId.safeParse(root).success||u.searchParams.getAll('comment_id').length!==1||u.searchParams.getAll('reply_comment_id').length>1||reply!==null&&!commentId.safeParse(reply).success||[...u.searchParams.keys()].some(k=>!['comment_id','reply_comment_id','fbclid','mibextid','ref','__cft__','__tn__'].includes(k)&&!k.startsWith('utm_')))return null;
 const postUrl=`https://www.facebook.com/groups/${path[1]!.toLowerCase()}/posts/${path[2]}`;
 return {postUrl,commentId:reply??root,rootCommentId:root,url:postUrl+'?comment_id='+root+(reply?'&reply_comment_id='+reply:'')};
}
const link=z.string().max(1000).refine(value=>commentLink(value)!==null);
const postLink=z.string().max(1000).refine(value=>/^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9_.-]{1,100}\/posts\/[A-Za-z0-9_-]{1,200}$/.test(value));
const thread=z.object({id:z.string().uuid(),postId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),postUrl:postLink,commentId,commentUrl:link,registeredAt:date,expiresAt:date}).strict().refine(v=>commentLink(v.commentUrl)?.postUrl===v.postUrl&&commentLink(v.commentUrl)?.commentId===v.commentId);
const response=z.object({id:z.string().uuid(),threadId:z.string().uuid(),commentId,parentCommentId:commentId,commentUrl:link,text:z.string().min(1).max(4000),postedAt:date,capturedAt:date,expiresAt:date,taskId:z.string().uuid().nullable()}).strict().refine(v=>commentLink(v.commentUrl)?.commentId===v.commentId&&commentLink(v.commentUrl)?.rootCommentId===v.parentCommentId&&v.commentId!==v.parentCommentId);
const page=z.object({threads:z.array(thread).max(20),responses:z.array(response).max(100),partial:z.boolean(),captureStatus:z.object({checkedAt:date,reason:z.string().max(100).nullable(),observedRunCostCents:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()}).strict().nullable(),autonomousCollectionEnabled:z.literal(false)}).strict().refine(v=>new Set(v.threads.map(t=>t.id)).size===v.threads.length&&new Set(v.responses.map(r=>r.id)).size===v.responses.length&&v.responses.every(r=>{const t=v.threads.find(t=>t.id===r.threadId);return t&&t.commentId===r.parentCommentId&&t.postUrl===commentLink(r.commentUrl)?.postUrl;}));
export type CommunityThread=z.infer<typeof thread>;
export type CommunityResponse=z.infer<typeof response>;
export type CommunityThreads=z.infer<typeof page>;
export type ThreadCommand={operationId:string;postId:number;commentUrl:string;confirmManualReply:true};
async function exchange(ownerId:string,path:string,method:'GET'|'POST'|'PUT',body:unknown,fetcher:typeof fetch,env:Record<string,string|undefined>):Promise<unknown>{
 if(!z.string().uuid().safeParse(ownerId).success||!env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET||! /^[A-Za-z0-9_-]{43,}$/.test(env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET))throw new AppError('UNAVAILABLE');
 let result:Response;try{result=await fetcher(origin+path,{method,headers:{Authorization:'Bearer '+env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify({...body as object,ownerId})}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000)});}catch{throw new AppError('UNAVAILABLE');}
 if(result.status===404)throw new AppError('NOT_FOUND');if(result.status===409)throw new AppError('CONFLICT');if(!result.ok)throw new AppError('UNAVAILABLE');
 try{if(!result.body)throw Error('body');const reader=result.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const value=await reader.read();if(value.done)break;size+=value.value.byteLength;if(size>1_000_000){await reader.cancel();throw Error('envelope');}chunks.push(value.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as {ok?:unknown;data?:unknown};if(parsed.ok!==true)throw Error('failed');return parsed.data;
 }catch{throw new AppError('UNAVAILABLE');}
}
export async function readCommunityThreads(ownerId:string,threadId?:string,fetcher:typeof fetch=fetch,env:Record<string,string|undefined>=process.env):Promise<CommunityThreads>{
 if(threadId!==undefined&&!z.string().uuid().safeParse(threadId).success)throw new AppError('NOT_FOUND');
 const value=page.safeParse(await exchange(ownerId,'/internal/life-skills/threads?'+new URLSearchParams({ownerId,...(threadId?{threadId}:{})}),'GET',undefined,fetcher,env));
 if(!value.success||threadId&&value.data.threads.some(t=>t.id!==threadId))throw new AppError('UNAVAILABLE');return value.data;
}
export async function registerCommunityThread(ownerId:string,command:ThreadCommand,fetcher:typeof fetch=fetch,env:Record<string,string|undefined>=process.env):Promise<CommunityThread>{
 const value=thread.safeParse(await exchange(ownerId,'/internal/life-skills/threads','POST',command,fetcher,env));
 if(!value.success||value.data.postId!==command.postId||value.data.commentUrl!==commentLink(command.commentUrl)?.url)throw new AppError('UNAVAILABLE');return value.data;
}
export async function pendingCommunityResponses(ownerId:string,fetcher:typeof fetch=fetch,env:Record<string,string|undefined>=process.env):Promise<{responses:CommunityResponse[];more:boolean}>{
 const value=z.object({responses:z.array(response).max(25),more:z.boolean()}).strict().safeParse(await exchange(ownerId,'/internal/life-skills/threads?'+new URLSearchParams({ownerId,pending:'true'}),'GET',undefined,fetcher,env));
 if(!value.success||new Set(value.data.responses.map(r=>r.id)).size!==value.data.responses.length||value.data.responses.some(r=>r.taskId!==null))throw new AppError('UNAVAILABLE');
 // Validate the whole bounded pending batch before any task is created. A URL
 // agreeing with its own parent ID is insufficient: its actual tracked thread
 // must bind that parent and post. Deduplicate readbacks (at most25) per batch.
 const threadIds=[...new Set(value.data.responses.map(r=>r.threadId))];
 const tracked=new Map(await Promise.all(threadIds.map(async id=>{
  const read=await readCommunityThreads(ownerId,id,fetcher,env),item=read.threads[0];
  if(read.threads.length!==1||!item||item.id!==id)throw new AppError('UNAVAILABLE');
  return [id,item] as const;
 })));
 if(value.data.responses.some(r=>{const item=tracked.get(r.threadId);return !item||item.commentId!==r.parentCommentId||item.postUrl!==commentLink(r.commentUrl)?.postUrl;}))throw new AppError('UNAVAILABLE');
 return value.data;
}
export async function acknowledgeCommunityTask(ownerId:string,responseId:string,taskId:string,fetcher:typeof fetch=fetch,env:Record<string,string|undefined>=process.env):Promise<void>{
 const value=z.object({responseId:z.literal(responseId),taskId:z.literal(taskId)}).strict().safeParse(await exchange(ownerId,'/internal/life-skills/threads/tasks','PUT',{responseId,taskId},fetcher,env));if(!value.success)throw new AppError('UNAVAILABLE');
}
