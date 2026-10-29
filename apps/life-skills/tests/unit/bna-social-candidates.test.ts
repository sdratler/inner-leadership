import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {bnaSocialCandidates,previewBnaSocialCandidate,type BnaSocialTags} from "../../src/features/bna-communications/social-candidates.ts";
it("retains all34 exact bilingual source candidates with copy digests and review state",()=>{
 const ids=[...Array.from({length:24},(_,n)=>`V${String(n+1).padStart(2,"0")}`),...Array.from({length:4},(_,n)=>`B0${n+1}`),...Array.from({length:4},(_,n)=>`F0${n+1}`),"S01","S02"];
 expect(bnaSocialCandidates.posts.map(value=>value.id)).toEqual(ids);expect(bnaSocialCandidates.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
 for(const post of bnaSocialCandidates.posts){expect(post.status).toBe("review_candidate");expect(post.content.en.length).toBeGreaterThan(0);expect(post.content.he.length).toBeGreaterThan(0);expect(createHash("sha256").update(JSON.stringify(post.content)).digest("hex")).toBe(post.copySha256);}
});
it("binds invitations to their own localized forms with stable content identity and bounded attribution",()=>{
 for(const [id,path] of [["B01","/join"],["F01","/fishing-academy/apply"],["S01","/support"]])for(const locale of ["en","he"] as const){
  const result=previewBnaSocialCandidate(id!,locale,{source:"facebook",campaign:"weekly_20261029",groupRef:"reviewed_group_1"});
  const link=result.body.match(/https:\/\/\S+/)![0]!,url=new URL(link);expect(url.origin).toBe("https://bneineviimacademy.org");expect(url.pathname).toBe((locale==="he"?"/he":"")+path);
  expect(url.searchParams.get("utm_content")).toBe(id);expect(url.searchParams.get("utm_source")).toBe("facebook");expect(url.searchParams.get("group_ref")).toBe("reviewed_group_1");
  expect(result.publicationState).toBe("not_queued");expect(result.destinationStatus).toBe("requires_live_check");expect(result.groupClassification).toBe("requires_rule_review");expect(result.body).not.toContain("{{");
 }
 const value=previewBnaSocialCandidate("V01","en");expect(value.business).toBe("placement_required");expect(value.body).toBe(bnaSocialCandidates.posts[0]!.content.en);
});
it("rejects unrecognized candidates and private-looking or arbitrary destination parameters",()=>{
 expect(()=>previewBnaSocialCandidate("unknown","en")).toThrow("BNA_SOCIAL_CANDIDATE_UNKNOWN");
 for(const bad of [{source:"person@example.invalid"},{campaign:"value\nextra"},{groupRef:"x".repeat(101)},{destination:"https://other.invalid"},{content:"different_post"}])expect(()=>previewBnaSocialCandidate("B01","en",bad as BnaSocialTags)).toThrow("BNA_SOCIAL_TAG_INVALID");
});
