import type {CampaignAttribution} from "../group-application/academy-campaign-contract.ts";
import type {FishingMarketingSnapshot} from "./contract.ts";
/** A visitor-supplied tag is a reference, not proof that a post caused a lead. */
export function matchingTaggedPosts(attribution:CampaignAttribution|null,snapshot:FishingMarketingSnapshot){
 if(!attribution)return [];
 const posts=new Map<string,string>();
 for(const item of [...snapshot.items,...snapshot.history]){
  if(!item.postUrl||!["browser_readback","operator_recorded_readback"].includes(item.publicationEvidence))continue;
  const path=new URL(item.postUrl).pathname,match=path.match(/\/(?:posts|permalink)\/([0-9]+)\/?$/);
  if(match)posts.set(`${item.groupId}/${match[1]}`,item.postUrl);
 }
 const matches=new Set<string>();
 for(const touch of [attribution.first,attribution.last]){
  if(touch.source!=="facebook"||!touch.groupRef||!touch.postRef)continue;
  const url=posts.get(`${touch.groupRef}/${touch.postRef}`);if(url)matches.add(url);
 }
 return [...matches];
}
