import {z} from "zod";
import {bnaEmailProgram} from "./delivery-policy.ts";

export const BNA_PREFERENCE_NOTICE={version:"BNA-EMAIL-PREFERENCES-20261029-v1",
 en:"Send me BNA educational or project updates for this program by email. I can unsubscribe at any time.",
 he:"אבקש לקבל בדוא״ל עדכונים חינוכיים או עדכוני פרויקט של בני נביאים עבור תוכנית זו. אפשר לבטל את ההרשמה בכל עת."} as const;
export const bnaOwnerPreferenceAction=z.enum(["pause_relationship","resume_relationship","pause_all","resume_all",
 "withdraw_relationship","withdraw_all","record_reply","triage_reply","record_invalid","resolve_invalid","record_complaint","resolve_complaint"]);
const commandBase={inquiryId:z.string().uuid(),operationId:z.string().uuid(),expectedVersion:z.number().int().min(0).max(2147483645)};
export const bnaOwnerPreferenceCommand=z.strictObject({...commandBase,action:bnaOwnerPreferenceAction,
 note:z.string().trim().min(3).max(1000)});
export type BnaOwnerPreferenceCommand=z.infer<typeof bnaOwnerPreferenceCommand>;
export const bnaRecipientPreferenceCommand=z.discriminatedUnion("action",[
 z.strictObject({...commandBase,action:z.literal("set_preferences"),updates:z.boolean(),locale:z.enum(["en","he"]),
  noticeVersion:z.literal(BNA_PREFERENCE_NOTICE.version),noticeLanguage:z.enum(["en","he"])}),
 z.strictObject({...commandBase,action:z.literal("unsubscribe_all")}),
]);
export type BnaRecipientPreferenceCommand=z.infer<typeof bnaRecipientPreferenceCommand>;
export const bnaPreferenceCapability=z.strictObject({version:z.literal(1),workspaceId:z.string().uuid(),ownerAccountId:z.string().uuid(),
 inquiryId:z.string().uuid(),recipientKey:z.string().regex(/^[a-f0-9]{64}$/),program:bnaEmailProgram,issuedAt:z.iso.datetime(),expiresAt:z.iso.datetime()});
export const bnaPreferenceToken=z.string().regex(/^[A-Za-z0-9_-]{100,2048}$/);
export type BnaPreferenceContext={inquiryId:string;program:z.infer<typeof bnaEmailProgram>;recipient:string;locale:"en"|"he";originalPermissionAt:string|null;originalNoticeVersion:string};
export type BnaPreferenceSnapshot={version:number;program:z.infer<typeof bnaEmailProgram>;locale:"en"|"he";
 permissionGrantedAt:string|null;withdrawn:boolean;paused:boolean;replyPending:boolean;invalidRecipient:boolean;complaint:boolean};
export function recipientBnaPreferences(snapshot:BnaPreferenceSnapshot){return {version:snapshot.version,program:snapshot.program,locale:snapshot.locale,
 updates:snapshot.permissionGrantedAt!==null&&!snapshot.withdrawn,
 deliveryPaused:snapshot.paused||snapshot.replyPending||snapshot.invalidRecipient||snapshot.complaint};}
