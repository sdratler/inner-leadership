import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,readJson,successResponse} from "../../lib/http/json.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../lib/security/rate-limit.ts";
import {floridaGroupApplicationNotice,floridaSchoolInquiryNotice,floridaGroupApplicationSubmissionSchema,floridaGroupApplicationReadSubmissionSchema,isTrip390Interest} from "./contract.ts";
import {issueFloridaGroupApplicationChallenge,issueTrip390Challenge,trip390ContinuationDigest,verifyGroupApplicationChallenge} from "./challenge.ts";
import {groupApplicationProgramFromRequest,requestsTrip390Interest,verifyGroupApplicationRequest} from "./public-origin.ts";
import {TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,TRIP390_OFFER,trip390ReadableCommandSchema,isCurrentTrip390Interest} from './academy-trip390-contract.ts';
import {TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER,trip390V1Notice} from './academy-trip390-v1.ts';
import {academyPublicOffer,trip390Notice,TRIP390_V1_MEDIA_TYPE,TRIP390_V2_MEDIA_TYPE,TRIP390_V3_MEDIA_TYPE} from './academy-trip390-transport.ts';
import {TRIP390_V2_INTEREST_VERSION,TRIP390_V2_NOTICE_VERSION,TRIP390_V2_OFFER,trip390V2Notice} from './academy-trip390-v2.ts';
import {TRIP390_V3_INTEREST_VERSION,TRIP390_V3_NOTICE_VERSION,TRIP390_V3_OFFER,trip390V3Notice} from './academy-trip390-v3.ts';
import {z} from 'zod';
import type {PublicGroupApplicationStore} from "./store.ts";
import {academyRegistrationNotice} from './academy-registration-notice.ts';
import {isFreeFounderRegistration} from './academy-founder-store.ts';
import type {FounderPublicResult} from './academy-founder-contract.ts';
import {opaqueToken,TOKEN_PATTERN} from '../identity/crypto.ts';

export type PublicGroupApplicationHttpDependencies={enabled:boolean;environment:Record<string,string|undefined>;challengeKey:string;
 now:()=>number;limits:RateLimitStore;store:Pick<PublicGroupApplicationStore,"submit">&Partial<Pick<PublicGroupApplicationStore,"replaySaved">>;
 /** Separate -07 reservation/privacy admission. It grants no financial terms,
  * participation waiver, typed-name or child-signature collection authority. */
 trip390ReservationAdmitted?:boolean;
 afterCommit?:(reference:string)=>Promise<"queued"|"unknown"|"sent"|"canceled"|"not_requested"|undefined>;
 refreshFounder?:(reference:string)=>Promise<FounderPublicResult|undefined>};

const trip390SubmissionSchema=trip390ReadableCommandSchema.extend({challenge:z.string().min(80).max(1024),website:z.literal('')}).strict();

export async function publicGroupApplicationHttp(request:Request,load:(trip390:boolean)=>Promise<PublicGroupApplicationHttpDependencies>):Promise<Response>{
 const requestId=randomUUID();let response:Response;let newContinuation:string|undefined;
 try{
  const trip390=requestsTrip390Interest(request);
  const dependencies=await load(trip390);if(!dependencies.enabled)throw new AppError("NOT_FOUND");
  if(!["GET","POST"].includes(request.method))throw new AppError("INVALID_REQUEST");
  verifyGroupApplicationRequest(request,dependencies.environment,request.method==="POST");const programId=groupApplicationProgramFromRequest(request);
  // The no-program route was the retired Israel intake. Do not issue a new
  // challenge, replay a receipt or recreate a legacy row through that route.
  if(!programId)throw new AppError("NOT_FOUND");
  if(trip390&&programId!=='sunday_fishing_academy')throw new AppError('FORBIDDEN');
  const publicOffer=academyPublicOffer(dependencies.environment);
  if(programId==='sunday_fishing_academy'&&publicOffer==='unavailable')throw new AppError('UNAVAILABLE');
  if(trip390&&publicOffer!=='trip390')throw new AppError('NOT_FOUND');
  const cookie=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('ls_academy_registration='));
  if(cookie.length>1)throw new AppError('INVALID_REQUEST');
  const existing=cookie[0]?.slice('ls_academy_registration='.length);if(existing&&!TOKEN_PATTERN.test(existing))throw new AppError('INVALID_REQUEST');
  const continuation=existing??opaqueToken();if(!existing&&request.method==='GET'&&programId==='sunday_fishing_academy')newContinuation=continuation;
  const historicalVersion=request.headers.get('accept')===TRIP390_V1_MEDIA_TYPE?3:request.headers.get('accept')===TRIP390_V2_MEDIA_TYPE?4:request.headers.get('accept')===TRIP390_V3_MEDIA_TYPE?5:null;
  const historicalTrip=trip390&&historicalVersion!==null,challengeVersion=historicalVersion??6;
  if(trip390&&!historicalTrip&&dependencies.environment.LS_ACADEMY_PUBLIC_OFFER!==TRIP390_OFFER.version)throw new AppError('UNAVAILABLE');
  if(trip390&&request.method==='GET'){
   response=successResponse({version:historicalVersion===3?TRIP390_V1_INTEREST_VERSION:historicalVersion===4?TRIP390_V2_INTEREST_VERSION:historicalVersion===5?TRIP390_V3_INTEREST_VERSION:TRIP390_INTEREST_VERSION,offerVersion:historicalVersion===3?TRIP390_V1_OFFER.version:historicalVersion===4?TRIP390_V2_OFFER.version:historicalVersion===5?TRIP390_V3_OFFER.version:TRIP390_OFFER.version,noticeVersion:historicalVersion===3?TRIP390_V1_NOTICE_VERSION:historicalVersion===4?TRIP390_V2_NOTICE_VERSION:historicalVersion===5?TRIP390_V3_NOTICE_VERSION:TRIP390_NOTICE_VERSION,
    notice:historicalVersion===3?trip390V1Notice:historicalVersion===4?trip390V2Notice:historicalVersion===5?trip390V3Notice:trip390Notice,challenge:issueTrip390Challenge(dependencies.challengeKey,continuation,dependencies.now(),undefined,challengeVersion)},requestId);
  }else if(trip390){
   const body=await readJson(request,trip390SubmissionSchema);
   const challenge=verifyGroupApplicationChallenge(body.challenge,dependencies.challengeKey,dependencies.now());
   if((challenge.v!==3&&challenge.v!==4&&challenge.v!==5&&challenge.v!==6)||challenge.v!==challengeVersion||!existing||challenge.programId!==programId||
    challenge.version!==body.fields.version||challenge.offerVersion!==body.fields.offerVersion||
    challenge.noticeVersion!==body.fields.acknowledgment.version||
    challenge.continuationDigest!==trip390ContinuationDigest(dependencies.challengeKey,existing))throw new AppError('FORBIDDEN');
   await enforceRateLimit(dependencies.limits,opaqueRateLimitKey("public-group-application:global",dependencies.challengeKey),30,60_000);
   const command={operationId:body.operationId,fields:body.fields};
   let result:Awaited<ReturnType<PublicGroupApplicationStore['submit']>>;
   if(historicalTrip){
    if(isCurrentTrip390Interest(body.fields))throw new AppError('FORBIDDEN');
    const saved=await dependencies.store.replaySaved?.(command);if(!saved)throw new AppError('INVALID_REQUEST');result=saved;
   }else{
    if(!isCurrentTrip390Interest(body.fields))throw new AppError('FORBIDDEN');
    const saved=await dependencies.store.replaySaved?.(command);
    if(saved)result=saved;
    else{if(!dependencies.trip390ReservationAdmitted)throw new AppError('FORBIDDEN');result=await dependencies.store.submit({operationId:body.operationId,fields:body.fields});}

   }
   // A prior application is never queued retroactively by a replay.
   let acknowledgment:string='acknowledgment' in result&&typeof result.acknowledgment==='string'?result.acknowledgment:'not_queued';
   if(!historicalTrip&&!result.replayed&&!result.duplicate&&acknowledgment==='queued'&&dependencies.afterCommit){try{const sent=await dependencies.afterCommit(result.item.id);acknowledgment=sent==='not_requested'?'not_queued':sent??acknowledgment;}catch{acknowledgment='unknown';}}
   response=successResponse({reference:result.item.id,operationId:body.operationId,acknowledgment,replayed:result.replayed},requestId,result.replayed||result.duplicate?200:201);
  }else if(request.method==="GET")response=successResponse({notice:floridaGroupApplicationNotice,...(programId==="sunday_fishing_academy"?{schoolNotice:floridaSchoolInquiryNotice,registrationNotice:academyRegistrationNotice}:{}),
   challenge:issueFloridaGroupApplicationChallenge(dependencies.challengeKey,programId,dependencies.now())},requestId);
  else{
   let result:Awaited<ReturnType<PublicGroupApplicationStore["submit"]>>;
   const historicalReplayOnly=publicOffer==='trip390'&&programId==='sunday_fishing_academy';
   {
    const body=await readJson(request,floridaGroupApplicationReadSubmissionSchema),challenge=verifyGroupApplicationChallenge(body.challenge,dependencies.challengeKey,dependencies.now());
    if(challenge.v!==2||isTrip390Interest(body.fields)||body.fields.programId!==challenge.programId||body.fields.programId!==programId)throw new AppError("FORBIDDEN");
    await enforceRateLimit(dependencies.limits,opaqueRateLimitKey("public-group-application:global",dependencies.challengeKey),30,60_000);
    const current=floridaGroupApplicationSubmissionSchema.safeParse(body);
    if(current.success&&!historicalReplayOnly){if(isTrip390Interest(current.data.fields))throw new AppError('FORBIDDEN');const command={operationId:current.data.operationId,fields:current.data.fields};result=isFreeFounderRegistration(command.fields)?await dependencies.store.submit(command,existing,current.data.attribution??null):await dependencies.store.submit(command);}
    else{const prior=await dependencies.store.replaySaved?.({operationId:body.operationId,fields:body.fields},body.attribution??null);
     if(!prior)throw new AppError("INVALID_REQUEST");result=prior;}
   }
   // submit/replay has completed its durable transaction. A mail error cannot undo or hide the saved inquiry.
   let acknowledgment:Awaited<ReturnType<NonNullable<PublicGroupApplicationHttpDependencies["afterCommit"]>>>;
   if(!historicalReplayOnly&&dependencies.afterCommit){try{acknowledgment=await dependencies.afterCommit(result.item.id);}catch{acknowledgment="unknown";}}
   if(!historicalReplayOnly&&result.founder&&dependencies.refreshFounder){
    const savedFounder=result.founder;
    // Only persisted state can establish SENT and its deadline. A failed
    // refresh must not hide the durable application or claim it is still queued.
    try{const founder=await dependencies.refreshFounder(result.item.id);if(!founder||founder.reference!==savedFounder.reference)throw new AppError('UNAVAILABLE');result={...result,founder};}
    catch{result={...result,founder:{...savedFounder,email:'unknown'}};}
   }
   response=successResponse({...result,...(acknowledgment?{acknowledgment}:{})},requestId,result.replayed||result.duplicate?200:201);
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 if(newContinuation)response.headers.append('Set-Cookie',`ls_academy_registration=${newContinuation}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`);
 return response;
}
