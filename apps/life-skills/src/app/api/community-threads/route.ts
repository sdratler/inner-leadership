import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {AppError,errorEnvelope} from '../../../lib/errors.ts';
import {readJson} from '../../../lib/http/json.ts';
import {verifyMutationOrigin,verifyCsrfToken} from '../../../lib/security/csrf.ts';
import {SESSION_COOKIE} from '../../../lib/security/session.ts';
import {identityRuntime} from '../../../features/identity/runtime.ts';
import {readCommunityThreads,registerCommunityThread,commentLink} from '../../../features/community-reply/threads-bridge.ts';
import {projectCommunityTasks} from '../../../features/community-reply/threads.ts';
import {InternalTaskService} from '../../../features/calendar/tasks.ts';
import {CalendarStore} from '../../../features/calendar/store.ts';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const command=z.object({operationId:z.string().uuid(),postId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),commentUrl:z.string().max(1000).refine(v=>commentLink(v)!==null),confirmManualReply:z.literal(true)}).strict();
async function context(request:Request){const matches=(request.headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+'='));if(matches.length!==1)throw new AppError('UNAUTHENTICATED');
 const token=matches[0]!.slice(SESSION_COOKIE.length+1),identity=await identityRuntime(),actor=await identity.services.sessions.actor(token);if(actor.role!=='practitioner')throw new AppError('FORBIDDEN');return {token,identity,actor};}
function fail(error:unknown){const result=errorEnvelope(error instanceof AppError?error:new AppError('UNAVAILABLE'),randomUUID());return NextResponse.json(result.body,{status:result.status,headers});}
export async function GET(request:Request){try{const {actor,identity,token}=await context(request),params=new URL(request.url).searchParams;if([...params.keys()].some(k=>k!=='threadId')||params.getAll('threadId').length>1)throw new AppError('INVALID_REQUEST');const data=await readCommunityThreads(actor.id,params.get('threadId')??undefined);const current=await identity.services.sessions.actor(token);if(current.role!=='practitioner'||current.id!==actor.id)throw new AppError('FORBIDDEN');return NextResponse.json({ok:true,data,requestId:randomUUID()},{headers});}catch(error){return fail(error);}}
export async function POST(request:Request){try{const {actor,identity,token}=await context(request);verifyMutationOrigin(request,identity.config.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),identity.services.sessions.csrf(token));const value=await readJson(request,command,8000);return NextResponse.json({ok:true,data:await registerCommunityThread(actor.id,value),requestId:randomUUID()},{headers});}catch(error){return fail(error);}}
export async function PUT(request:Request){try{const {actor,identity,token}=await context(request);verifyMutationOrigin(request,identity.config.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),identity.services.sessions.csrf(token));await readJson(request,z.object({}).strict(),1000);
 if(process.env.LS_CALENDAR_ENABLED!=='true')throw new AppError('UNAVAILABLE');
 const tasks=new InternalTaskService(new CalendarStore(identity.store,identity.config.keyring,identity.clock),identity.config.lookupKey);
 const result=await projectCommunityTasks(actor,tasks);return NextResponse.json({ok:true,data:result,requestId:randomUUID()},{headers});
 }catch(error){return fail(error);}}
