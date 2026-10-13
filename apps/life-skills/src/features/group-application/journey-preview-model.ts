import type {FloridaProgramId} from "./contract.ts";
import {academyLandingDraft} from "./academy-draft.ts";
import type {Locale} from "../../lib/locale.ts";

export const journeyPrograms:readonly FloridaProgramId[]=["sunday_fishing_academy","morning_torah_learning","private_fishing_life_skills"];
export const journeyStages=["inquiry","status","fit-call","offer","payment","receipt","enrollment","next"] as const;
export type JourneyStage=typeof journeyStages[number];
export function journeyPreviewEnabled(env:Record<string,string|undefined>):boolean{
 try{
  const origin=new URL(env.LS_APP_ORIGIN??""),db=new URL(env.LS_DATABASE_URL??"");
  return env.LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK==="true"&&env.LS_APP_MODE==="foundation_preview"&&
   origin.protocol==="https:"&&["localhost","127.0.0.1"].includes(origin.hostname)&&
   ["postgres:","postgresql:"].includes(db.protocol)&&["localhost","127.0.0.1"].includes(db.hostname)&&
   /^\/ls_calendar_test_[A-Za-z0-9_]+$/.test(db.pathname)&&!db.search&&!db.hash;
 }catch{return false;}
}
export function journeyProgramName(program:FloridaProgramId,locale:Locale){
 const names={sunday_fishing_academy:academyLandingDraft.label,morning_torah_learning:{en:"Morning Torah Learning",he:"לימוד תורה בבוקר"},private_fishing_life_skills:{en:"Private Fishing & Life Skills",he:"דיג וכישורי חיים באופן פרטי"}};
 return names[program][locale];
}
export function journeyLandingPath(program:FloridaProgramId,locale:Locale){return `/${locale}/florida${program==="morning_torah_learning"?"/torah-mornings":program==="private_fishing_life_skills"?"/private-fishing":""}`;}
/** Provenance for the curated, stage-appropriate sample text. The private drafts remain in Drive. */
export const journeySourceManifest={
 instruction:"LS-FISH-SUNDAY12-20261013-05",
 privateProposal:{instruction:"LS-FISH-MODULE-ROLLING-20261013-06",deliveryInstruction:"LS-FISH-DAYTIME-ENROLL-20261013-08",websiteSection:36,productSection:35,scope:"authenticated owner sample only",status:"proposed; not implemented",sourceRevision:"AHj4eMShtGydOReKF8LZLCKZ023OW3-0iY7tqQpgastniGQ85n3GHS8wARt8-PWFub4nGYbhRRCm7IqQA76LwAMfqKRegRtLU5H-lodIgjI",forms:"daytime mapping pending; v3.2/v3.3 draft history not family-use terms",moduleStart:"unresolved",maximumWait:"unresolved",institutionalInquiry:"not implemented; separate nonclinical owner-review path required"},
 academy:{start:"1fyrcMEBOsf1T50m3JN-iexE96fbxvpDQfTFHLYhctT0",websiteSection:35,productSection:34,status:"proposed",commercialAgreement:"reviewed draft; actual offer and family-use approval pending",draftVersion:"3.2",english:{id:"16xfmqnq1_U3gQua9m30ZQyiwDcvWsrzM",sha256:"034ce55d694e693e40167dc6536964115681d179fc57b7fff20784bb72febd16"},hebrew:{id:"1dSo0DNaxSF1tN3q7wTKaAr86QRrIv99E",sha256:"c728587361e9c348e477507b1302ec90b62ebb563d3b3e35548f20515dda3f81"}},
 english:{id:"1eS55mzzs6FOdzL0N90fNjtMyIhExq-wH",version:"2.0",sections:["F02","F03","F03-S","F03-T","F03-P","F09"]},
 hebrew:{id:"1Dbkco3GzZ0WmyJGIxA7RTprkF0xo5e-_",version:"2.1",sha256:"bf156b6c5dffa80c850c011893479711b971bf84815d0a79995b090912da636e"},
 privacy:{id:"1J3fbkjHo2MJojMfaHKbvUAum83D4yhCW",version:"2.1",sha256:"7ceb3cdd9c3c44a6ee50660b993f39e511d4299a31a762a91c30c7d850c66307"},
} as const;
