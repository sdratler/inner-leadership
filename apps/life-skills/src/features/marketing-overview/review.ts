import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,readJson,successResponse} from "../../lib/http/json.ts";
import {verifyCsrfToken,verifyMutationOrigin} from "../../lib/security/csrf.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {identityRuntime} from "../identity/runtime.ts";
import {validateMarketingSnapshot} from "./read-model.ts";
import type {CreativeVersion} from "./contracts.ts";
const command=z.object({assetId:z.string().regex(/^[A-Za-z0-9._-]{1,200}$/),revision:z.number().int().min(1).max(999999),digest:z.string().regex(/^[a-f0-9]{64}$/),reviewToken:z.string().regex(/^[a-f0-9]{64}$/),operationId:z.string().uuid(),decision:z.enum(["approve_artwork","needs_revision"]),note:z.string().max(1200)}).strict().refine(value=>value.decision!=="needs_revision"||value.note.trim().length>0);
export type ArtworkReviewCommand=z.infer<typeof command>;
export type ArtworkReviewResult={saved:true;readbackVerified:true;replayed:boolean;operationId:string;decision:ArtworkReviewCommand["decision"];note:string;savedAt:string;asset:CreativeVersion};
async function authorize(request:Request){
 const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(`${SESSION_COOKIE}=`));
 if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
 const token=cookies[0]!.slice(SESSION_COOKIE.length+1),identity=await identityRuntime(),actor=await identity.services.sessions.actor(token);
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
 verifyMutationOrigin(request,identity.config.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),identity.services.sessions.csrf(token));
}
/** Academy artwork reviews need an Academy-owned registry. The retired bridge
 * must never receive a write merely because its old credentials still exist. */
export async function saveArtworkReviewBridge(_input:ArtworkReviewCommand):Promise<ArtworkReviewResult>{
 void _input;
 throw new AppError("UNAVAILABLE");
}
export async function marketingReview(request:Request,deps={authorize,save:saveArtworkReviewBridge}):Promise<Response>{
 const requestId=randomUUID();
 try{
  await deps.authorize(request);const input=await readJson(request,command,16384),result=await deps.save(input),asset=result?.asset,review=asset?.artworkReview;
  if(result?.saved!==true||result.readbackVerified!==true||result.operationId!==input.operationId||result.decision!==input.decision||result.note!==input.note||typeof result.replayed!=="boolean"||!asset||asset.assetId!==input.assetId||asset.revision!==input.revision||asset.contentDigest!==input.digest||asset.registeredRevision!==true||asset.libraryState!=="CURRENT_ACCEPTED_HELD"||!review||review.operationId!==input.operationId||review.decision!==input.decision||review.note!==input.note||review.savedAt!==result.savedAt||asset.review!==(input.decision==="approve_artwork"?"approved":"in_review")||asset.approvedDigest!==(input.decision==="approve_artwork"?input.digest:null))throw new AppError("UNAVAILABLE");
  validateMarketingSnapshot({source:"registry_only",fetchedAt:result.savedAt,creatives:[asset],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:"unbound"}});
  const response=successResponse(result,requestId);response.headers.set("Referrer-Policy","no-referrer");return response;
 }catch(error){const response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);response.headers.set("Referrer-Policy","no-referrer");return response;}
}
