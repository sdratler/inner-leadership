import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './errors.ts';
import {failureResponse,readJson,successResponse} from './http/json.ts';
import {SESSION_COOKIE} from './security/session.ts';
import {verifyMutationOrigin,verifyCsrfToken} from './security/csrf.ts';
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from './security/rate-limit.ts';
import {TOKEN_PATTERN} from '../features/identity/crypto.ts';
import type {IdentitySessions} from '../features/identity/session-adapter.ts';
import {canonicalForwardedRequest} from '../features/integration/canonical-forwarded-request.ts';
import {FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,fishingFamilyProposalCommandSchema,
 fishingInquiryFamilyProposalSchema,fishingInquiryFamilyProposalPreviewSchema,type FishingBillingInquiryFamilyProposals} from './fishing-billing-inquiry-family-proposal.ts';
import {NATIVE_FAMILY_VERSION,nativeFamilyCreateCommandSchema} from '../features/fishing-billing/native-family-contract-v1.ts';

export const FISHING_INQUIRY_FAMILY_PROPOSAL_OWNER_PATH='/api/private/fishing-inquiry-family-proposals';
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('preview'),expectedEpoch:fishingFamilyProposalCommandSchema.shape.expectedEpoch,
  selection:fishingFamilyProposalCommandSchema.shape.selection}).strict(),
 z.object({action:z.literal('propose'),command:fishingFamilyProposalCommandSchema}).strict(),
 z.object({action:z.literal('create_native_family'),command:nativeFamilyCreateCommandSchema}).strict(),
]);
const read=z.object({reference:z.uuid(),expectedEpoch:fishingFamilyProposalCommandSchema.shape.expectedEpoch}).strict();
export type FishingInquiryFamilyProposalOwnerHttpDependencies={
 origin:string;sessions:IdentitySessions;limits:RateLimitStore;rateLimitKey:string;store:FishingBillingInquiryFamilyProposals;
};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Owner-only adapter for proposed associations, not financial or
 * guardian approval. The mandatory real store rechecks current owner/source/
 * native facts in its transaction, including the terminal session check.
 * No actor-free data port, runtime, provider, sender or default dependency is
 * exposed here. A lost response must retain and retry the original command. */
export async function fishingInquiryFamilyProposalOwnerHttp(request:Request,
 load:()=>Promise<FishingInquiryFamilyProposalOwnerHttpDependencies>):Promise<Response>{
 const requestId=randomUUID();let response:Response,proposalInvoked=false;
 try{
  const cookies=(request.headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+'='));
  if(cookies.length!==1)throw new AppError('UNAUTHENTICATED');
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);
  if(!TOKEN_PATTERN.test(token))throw new AppError('UNAUTHENTICATED');
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!==FISHING_INQUIRY_FAMILY_PROPOSAL_OWNER_PATH||url.hash)throw new AppError('NOT_FOUND');
  if(request.method!=='GET'&&request.method!=='POST')throw new AppError('INVALID_REQUEST');
  const actor=await d.sessions.actor(token);
  if(actor.role!=='practitioner'||actor.state!=='active')throw new AppError('FORBIDDEN');
  const key=opaqueRateLimitKey(`fishing-family-proposal-owner:${actor.workspaceId}:${actor.id}:${request.method}`,d.rateLimitKey);
  if(request.method==='GET'){
   if(url.searchParams.size!==2||url.searchParams.getAll('reference').length!==1||url.searchParams.getAll('expectedEpoch').length!==1||
    !/^(0|[1-9]\d{0,15})$/.test(url.searchParams.get('expectedEpoch')??''))throw new AppError('INVALID_REQUEST');
   const parsed=read.safeParse({reference:url.searchParams.get('reference'),expectedEpoch:Number(url.searchParams.get('expectedEpoch'))});
   if(!parsed.success)throw new AppError('INVALID_REQUEST');
   await enforceRateLimit(d.limits,key,60,60_000);
   const record=fishingInquiryFamilyProposalSchema.parse(await d.store.read(actor,parsed.data));
   if(record.workspaceId!==actor.workspaceId||record.command.selection.reference!==parsed.data.reference)throw new AppError('UNAVAILABLE');
   response=successResponse({version:FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,kind:'proposal',record},requestId);
  }else{
   if(url.search)throw new AppError('INVALID_REQUEST');
   verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),d.sessions.csrf(token));
   await enforceRateLimit(d.limits,key,20,60_000);
   const input=await readJson(request,command);
   if(input.action==='preview'){
    const preview=fishingInquiryFamilyProposalPreviewSchema.parse(await d.store.preview(actor,{expectedEpoch:input.expectedEpoch,selection:input.selection}));
    if(!equal(preview.selection,input.selection))throw new AppError('UNAVAILABLE');
    response=successResponse({version:FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,kind:'preview',preview},requestId);
   }else if(input.action==='create_native_family'){
    // Once invoked, a lost driver/commit response cannot prove rollback.
    proposalInvoked=true;
    const saved=await d.store.createNativeFamily(actor,input.command),record=fishingInquiryFamilyProposalSchema.parse(saved.record);
    const c=input.command,choice=record.command.selection;
    if(saved.version!==NATIVE_FAMILY_VERSION||saved.resultKind!=='original_creation_receipt'||typeof saved.replayed!=='boolean'||
     record.workspaceId!==actor.workspaceId||record.recordedBy!==actor.id||record.command.operationId!==c.operationId||
     record.command.expectedEpoch!==c.expectedEpoch||record.command.expectedSourceDigest!==c.expectedSourceDigest||
     choice.reference!==c.reference||choice.familyId!==c.familyId||!equal(choice.children,c.children))throw new AppError('UNAVAILABLE');
    response=successResponse({version:NATIVE_FAMILY_VERSION,kind:'native_family_created',resultKind:saved.resultKind,record,replayed:saved.replayed},requestId);
   }else{
    // The transaction adapter may fail after COMMIT. Once invoked, no typed
    // error proves rollback; retain the original operation for read/replay.
    proposalInvoked=true;
    const saved=await d.store.propose(actor,input.command),record=fishingInquiryFamilyProposalSchema.parse(saved.record);
    if(record.workspaceId!==actor.workspaceId||record.recordedBy!==actor.id||!equal(record.command,input.command)||typeof saved.replayed!=='boolean')throw new AppError('UNAVAILABLE');
    response=successResponse({version:FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,kind:'proposed',record,replayed:saved.replayed},requestId);
   }
  }
 }catch(error){response=failureResponse(proposalInvoked?new AppError('UNAVAILABLE'):error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
 return response;
}
