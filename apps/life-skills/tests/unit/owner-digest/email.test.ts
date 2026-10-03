import {expect,it} from "vitest";
import {buildOwnerDigest} from "../../../src/features/owner-digest/model.ts";
import {ownerDigestEmail,ownerReportDateKey} from "../../../src/features/owner-digest/email.ts";
const digest=buildOwnerDigest({now:new Date("2026-10-02T06:00:00Z"),marketing:{source:"registry_only",fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:"unbound"}},followups:null,tasks:null,journeysAvailable:false,locale:"en"});
it("prepares one owner-only mobile email with no sender or external chart/pixel",()=>{
 const email=ownerDigestEmail(digest,"https://life-skills.bneineviimacademy.org","en");
 expect(email.recipient).toBe("sdratler@gmail.com");expect(email.sendEnabled).toBe(false);expect(email.html).toContain('max-width:640px');expect(email.text).toContain("Unknown");expect(email.text).toContain("handover not verified");expect(email.html).not.toMatch(/<img|<script|clinical|access_token|iframe/);expect(email.dateKey).toBe(ownerReportDateKey(digest.reportDate,"sdratler@gmail.com","Life Skills follow-ups"));
 expect(()=>ownerReportDateKey(digest.reportDate,"prospect@example.invalid")).toThrow();expect(()=>ownerReportDateKey("2026-02-30")).toThrow();expect(()=>ownerDigestEmail(digest,"http://bad.invalid","en")).toThrow();
});
it("supports Hebrew and escapes even malformed source labels instead of making active HTML",()=>{
 const d={...digest,content:{...digest.content,nextStatus:{at:"2026-10-03T17:00:00Z",status:'<img src="bad">'}}};
 const email=ownerDigestEmail(d,"https://life-skills.bneineviimacademy.org","he");expect(email.html).toContain('lang="he" dir="rtl"');expect(email.html).toContain("&lt;img");expect(email.html).not.toContain('<img src="bad">');expect(email.text).toContain("ללא");
});
