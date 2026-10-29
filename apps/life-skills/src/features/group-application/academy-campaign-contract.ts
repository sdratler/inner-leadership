import {z} from 'zod';
export const ACADEMY_CAMPAIGN='JLFA-PREREG-LAUNCH-20261023-05';
export const PREREG_CREATIVE={id:'jlfa-prereg-square-20261023',version:1,sha256:'b6123180215e697ac8ea19f6750ca5304bc3acbfc70301b5ee81ef3430b98262',path:'/groups/academy/prereg-approved-square-20261023.png'} as const;
export const campaignPhaseSchema=z.enum(['PRE_REGISTRATION','REGULAR_REGISTRATION']);
export type CampaignPhase=z.infer<typeof campaignPhaseSchema>;
export const campaignSnapshotSchema=z.object({version:z.literal(ACADEMY_CAMPAIGN),phase:campaignPhaseSchema,revision:z.number().int().nonnegative(),capacity:z.literal(30),occupied:z.number().int().min(0).max(30),remaining:z.number().int().min(0).max(30),asOf:z.iso.datetime(),firstFilledAt:z.iso.datetime().nullable(),reopeningPolicy:z.literal('PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION')}).strict().superRefine((v,c)=>{
 if(v.remaining!==30-v.occupied||(v.phase==='REGULAR_REGISTRATION')!==(v.firstFilledAt!==null)||v.occupied===30&&!v.firstFilledAt)c.addIssue({code:'custom',message:'incoherent campaign snapshot'});
});
export type CampaignSnapshot=z.infer<typeof campaignSnapshotSchema>;
/** Registered nonpersonal tokens only. Arbitrary UTM strings/URLs are discarded. */
const nonPersonalRef=z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
export const campaignTouchSchema=z.object({campaign:z.literal(ACADEMY_CAMPAIGN),source:z.enum(['facebook','whatsapp','website','direct']),medium:z.enum(['social','message','direct']),content:z.literal(PREREG_CREATIVE.id),postRef:nonPersonalRef.optional(),groupRef:nonPersonalRef.optional()}).strict();
export const campaignAttributionSchema=z.object({first:campaignTouchSchema,last:campaignTouchSchema}).strict();
export type CampaignAttribution=z.infer<typeof campaignAttributionSchema>;
export function campaignTouchFromUrl(url:URL){const p=url.searchParams,ref=(key:string)=>{const value=p.get(key);return value&&nonPersonalRef.safeParse(value).success?value:undefined;},postRef=ref('post_ref'),groupRef=ref('group_ref');const parsed=campaignTouchSchema.safeParse({campaign:p.get('utm_campaign'),source:p.get('utm_source'),medium:p.get('utm_medium'),content:p.get('utm_content'),...(postRef?{postRef}:{}),...(groupRef?{groupRef}:{})});return parsed.success?parsed.data:null;}
export function captureCampaignAttribution(url:URL,storage:Pick<Storage,'getItem'|'setItem'>):CampaignAttribution|null{
 const key='jlfa/campaign-attribution/v1',touch=campaignTouchFromUrl(url);let previous:CampaignAttribution|null=null;
 try{const parsed=campaignAttributionSchema.safeParse(JSON.parse(storage.getItem(key)??'null'));if(parsed.success)previous=parsed.data;}catch{}
 const next=touch?{first:previous?.first??touch,last:touch}:previous;
 try{if(next)storage.setItem(key,JSON.stringify(next));}catch{}
 return next;
}
export const campaignShareCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare_share'),operationId:z.uuid(),placement:z.enum(['facebook_feed','whatsapp_status','whatsapp_message']),language:z.enum(['en','he']),captionId:z.string().regex(/^[a-z0-9-]{1,80}$/),captionVersion:z.number().int().positive(),captionSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.enum(['copy_share','export_share','withdraw_share']),operationId:z.uuid(),shareId:z.uuid(),reason:z.string().trim().min(3).max(600),postUrl:z.url().max(1000).optional()}).strict(),
 z.object({action:z.literal('confirm_manual_publication'),operationId:z.uuid(),shareId:z.uuid(),reason:z.string().trim().min(3).max(600),publishedAt:z.iso.datetime(),postUrl:z.url().max(1000).optional()}).strict(),
]);
export type CampaignShareCommand=z.infer<typeof campaignShareCommandSchema>;
export function academyCampaignTarget(language:'en'|'he',placement:'facebook_feed'|'whatsapp_status'|'whatsapp_message'){
 const path=language==='he'?'/he/fishing-academy':'/fishing-academy';
 return 'https://bneineviimacademy.org'+path+'?'+new URLSearchParams({utm_campaign:ACADEMY_CAMPAIGN,utm_source:placement==='facebook_feed'?'facebook':'whatsapp',utm_medium:placement==='facebook_feed'?'social':'message',utm_content:PREREG_CREATIVE.id});
}
export const PAYMENT_REMINDER_SCHEDULE={hour:10,timezone:'America/New_York',approval:'PROPOSED_PENDING_OWNER_CONFIRMATION',whatsapp:'UNSELECTED',cadence:'DAILY_PAYMENT_ONLY'} as const;
export function floridaDate(value:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
export type PaymentReminderProjection={version:'jlfa-unpaid-lines-v1';familyId:string;offerId:string;generation:number;lines:{childId:string;offerId:string;revision:number;currency:'USD';unpaidCents:number;state:'active'|'paid'|'processing'|'unknown'|'closed';sentAt:string|null;deadline:string|null}[]};
export function currentReminderLines(p:PaymentReminderProjection,f:{id:string;offer:{id:string;children:{id:string;amount:number}[]}|null;payment:{generation:number;sentAt:string|null;deadline:string|null};redeemedChildIds:string[];children:{id:string;name:string}[]},now:Date){
 if(p.version!=='jlfa-unpaid-lines-v1'||p.familyId!==f.id||!f.offer||p.offerId!==f.offer.id||p.generation!==f.payment.generation||p.lines.length!==f.offer.children.length||new Set(p.lines.map(l=>l.childId)).size!==p.lines.length)throw Error('UNVERIFIED_PAYMENT_LINES');
 for(const l of p.lines){const offered=f.offer.children.find(c=>c.id===l.childId);if(!offered||!f.children.some(c=>c.id===l.childId)||l.offerId!==p.offerId||!Number.isSafeInteger(l.revision)||l.revision<1||l.currency!=='USD'||!Number.isSafeInteger(l.unpaidCents)||l.unpaidCents<0||l.unpaidCents>offered.amount*100||!['active','paid','processing','unknown','closed'].includes(l.state)||(l.state==='paid')!==f.redeemedChildIds.includes(l.childId)||l.state==='paid'&&l.unpaidCents!==0||l.sentAt!==f.payment.sentAt||l.deadline!==f.payment.deadline||l.sentAt!==null&&!z.iso.datetime().safeParse(l.sentAt).success||l.deadline!==null&&!z.iso.datetime().safeParse(l.deadline).success)throw Error('UNVERIFIED_PAYMENT_LINES');}
 // Current store has one immutable offer window. Distinct child windows require
 // a separately persisted/admitted contract; a callback cannot invent them.
 if(!f.payment.sentAt||!f.payment.deadline||new Date(f.payment.deadline)<=now)return [];
 if(p.lines.some(l=>l.state==='processing'||l.state==='unknown'))return [];
 return p.lines.filter(l=>l.state==='active'&&l.unpaidCents>0&&l.sentAt&&l.deadline&&new Date(l.sentAt)<=now&&new Date(l.deadline)>now&&floridaDate(new Date(l.sentAt))<floridaDate(now)).map(l=>({...l,name:f.children.find(c=>c.id===l.childId)!.name}));
}

/** Delivered only by the existing authenticated owner readback; no draft text in client modules. */
export type AcademyOrganicCaptionReview={bankDocumentId:string;sourceContentVersion:string;captions:{id:string;sourceId:string;version:number;language:string;direction:string;title:string;text:string;sha256:string;state:string;claimGuardrail:string}[]};
