import {z} from "zod";
import candidates from "./social-candidates.json";
type Locale="en"|"he";
const code=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
const tagsSchema=z.object({source:code.optional(),medium:code.optional(),campaign:code.optional(),groupRef:code.optional(),postRef:code.optional()}).strict();
export type BnaSocialTags=z.infer<typeof tagsSchema>;
export const bnaSocialCandidates=candidates;

/** Plain-text review only: no queue, schedule, provider or approval is created.
 * A destination still requires live acceptance, and each group's actual rules
 * determine whether an educational contribution counts as a promotion. */
export function previewBnaSocialCandidate(id:string,locale:Locale,tags:BnaSocialTags={}){
 const post=candidates.posts.find(value=>value.id===id);
 if(!post||post.status!=="review_candidate"||!["en","he"].includes(locale))throw Error("BNA_SOCIAL_CANDIDATE_UNKNOWN");
 const parsed=tagsSchema.safeParse(tags);if(!parsed.success)throw Error("BNA_SOCIAL_TAG_INVALID");
 const paths:Record<string,string>={BNA_JOIN_URL:"/join",FISHING_APPLY_URL:"/fishing-academy/apply",SUPPORT_URL:"/support",ARTICLES_URL:"/blog"};
 const resolve=(key:string)=>{
  if(!Object.hasOwn(paths,key))throw Error("BNA_SOCIAL_BINDING_UNKNOWN");
  const url=new URL((locale==="he"?"/he":"")+paths[key],"https://bneineviimacademy.org");
  for(const [field,param] of [["source","utm_source"],["medium","utm_medium"],["campaign","utm_campaign"],["groupRef","group_ref"],["postRef","post_ref"]] as const){const value=parsed.data[field];if(value)url.searchParams.set(param,value);}
  url.searchParams.set("utm_content",post.id);return url.toString();
 };
 const body=post.content[locale].replace(/\{\{([A-Z_]+)\}\}/g,(_match,key:string)=>resolve(key));
 if(/\{\{|\}\}/.test(body))throw Error("BNA_SOCIAL_BINDING_UNRESOLVED");
 return {id:post.id,title:post.title,type:post.type,business:post.business,locale,body,
  status:"review_candidate" as const,publicationState:"not_queued" as const,destinationStatus:"requires_live_check" as const,
  groupClassification:"requires_rule_review" as const,assetInstruction:post.assetInstruction,
  sourceSha256:candidates.sourceSha256,copySha256:post.copySha256};
}
