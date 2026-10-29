import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {freshActor} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import type {IdentityStore} from "../identity/store.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import {PublicGroupApplicationStore} from "../group-application/store.ts";
import {AcademyCampaignStore} from "../group-application/academy-campaign-store.ts";
import type {FishingMarketingSnapshot} from "./contract.ts";
import {matchingTaggedPosts} from "./attribution.ts";
export type TaggedInquiryPage={links:{applicationId:string;postUrl:string}[];nextCursor:string|null};
/** Owner-only keyset scan of existing Fishing inquiry attribution; no CRM copy. */
export async function readTaggedInquiries(db:IdentityStore,workspace:WorkspaceId,ring:Keyring,key:string,ownerId:string,clock:IdentityClock,actor:Actor,snapshot:FishingMarketingSnapshot,cursor?:string):Promise<TaggedInquiryPage>{
 if(actor.workspaceId!==workspace||actor.id!==ownerId)throw new AppError("NOT_FOUND");
 const aad=`ls_service_interest/fishing_marketing_cursor/v1/${workspace}/${actor.id}`;
 let anchor:string|undefined;
 if(cursor!==undefined){try{
  if(!/^[A-Za-z0-9_-]{64,2048}$/.test(cursor))throw new Error();
  const encoded=Buffer.from(cursor,"base64url");if(encoded.toString("base64url")!==cursor)throw new Error();
  anchor=z.strictObject({id:z.string().uuid()}).parse(JSON.parse(unseal(encoded.toString("utf8"),aad,ring))).id;
 }catch{throw new AppError("INVALID_REQUEST");}}
 const applications=new PublicGroupApplicationStore(db,workspace,ring,key,clock),campaign=new AcademyCampaignStore(workspace,ring,key,()=>clock.now());
 return db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");const current=await freshActor(tx,actor,clock.now());
  if(current.role!=="practitioner"||current.state!=="active"||current.id!==ownerId)throw new AppError("NOT_FOUND");
  const rows=await tx.query<{id:string}>(`SELECT DISTINCT application_id AS id FROM ls_service_interest.academy_campaign_touches WHERE workspace_id=$1 AND ($2::uuid IS NULL OR application_id>$2::uuid) ORDER BY application_id LIMIT 101`,[workspace,anchor??null]);
  const links:TaggedInquiryPage["links"]=[];
  for(const row of rows.slice(0,100)){
   const attribution=await campaign.applicationAttribution(tx,row.id),posts=matchingTaggedPosts(attribution,snapshot);if(!posts.length)continue;
   try{await applications.readForOwnerInTransaction(tx,actor,row.id);}catch(error){if(error instanceof AppError&&error.code==="NOT_FOUND")continue;throw error;}
   for(const postUrl of posts)links.push({applicationId:row.id,postUrl});
  }
  return {links,nextCursor:rows.length>100?Buffer.from(seal(JSON.stringify({id:rows[99]!.id}),aad,ring)).toString("base64url"):null};
 });
}
