import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {bnaEmailCandidates,previewBnaEmailCandidate} from "../../src/features/bna-communications/email-candidates.ts";

it("retains all 15 supplied bilingual candidates and their exact copy digests",()=>{
 expect(bnaEmailCandidates.messages.map(value=>value.id)).toEqual(['B0','B1','B2','B3','B4','B5','S0','S1','S2','S3','D0','D1','D2','D3','D4'].map(id=>'EMAIL-'+id));
 for(const message of bnaEmailCandidates.messages){expect(message.status).toBe('review_candidate');expect(createHash('sha256').update(JSON.stringify(message.content)).digest('hex')).toBe(message.copySha256);}
});
it("makes a review preview with a natural empty-name greeting and required real bindings",()=>{
 const result=previewBnaEmailCandidate('EMAIL-B0','en',{REFERENCE:'Synthetic-reference'});
 expect(result.body.startsWith('Hi,\n')).toBe(true);expect(result.body).toContain('Synthetic-reference');expect(result.status).toBe('review_candidate');
 expect(previewBnaEmailCandidate('EMAIL-B0','he',{REFERENCE:'Synthetic-reference'}).body.startsWith('שלום,\n')).toBe(true);
 expect(()=>previewBnaEmailCandidate('EMAIL-B0','en',{})).toThrow('BNA_EMAIL_BINDING_INVALID');
 expect(()=>previewBnaEmailCandidate('EMAIL-B0','en',{REFERENCE:'value\nextra'})).toThrow('BNA_EMAIL_BINDING_INVALID');
 expect(()=>previewBnaEmailCandidate('unknown','en',{})).toThrow('BNA_EMAIL_CANDIDATE_UNKNOWN');
});
it("rejects external and credential-bearing URLs in candidate previews",()=>{
 for(const value of ['https://other.invalid/support','https://user:pass@bneineviimacademy.org/support','https://bneineviimacademy.org/support?private=value','http://bneineviimacademy.org/support'])expect(()=>previewBnaEmailCandidate('EMAIL-S2','en',{SUPPORT_URL:value})).toThrow('BNA_EMAIL_URL_INVALID');
 expect(previewBnaEmailCandidate('EMAIL-S2','en',{SUPPORT_URL:'https://bneineviimacademy.org/support'}).body).toContain('https://bneineviimacademy.org/support');
});
