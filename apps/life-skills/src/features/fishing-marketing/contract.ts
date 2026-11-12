import {z} from "zod";

const group=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.iso.datetime({offset:true});
const timezone=z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}});
const profile=z.string().regex(/^[0-9]{5,32}$/).nullable();
const postUrl=z.url().nullable();
const preparation=z.strictObject({status:z.enum(['policy_review','rules_review','history_review','unresolved_delivery','cooldown','ready','group_held','target_held']),
 nextEligibleAt:instant.nullable(),rulesCheckedAt:instant.nullable(),lastPublishedAt:instant.nullable(),canPrepare:z.boolean()});
const review=z.strictObject({postingIdentity:z.literal('personal'),membershipVerifiedAt:instant.nullable(),rulesCheckedAt:instant,rulesUrl:z.url(),
 ruleNote:z.string().min(1).max(2000).refine(s=>s.trim().length>0),ownerNote:z.string().min(1).max(2000).refine(s=>s.trim().length>0),promotionAllowed:z.boolean(),cooldownDays:z.number().int().min(7).max(365)});
const target=z.strictObject({id:group,name:z.string().max(200),url:z.url(),eligible:z.boolean(),hold:z.enum(["complaint","removed"]).nullable(),preparation:preparation.optional(),review:review.optional()});
const asset=z.strictObject({id:z.string().min(1).max(180),language:z.enum(["en","he"]),caption:z.string().min(1).max(5000),captionSha256:hash,imageSha256:hash});
const queueItem=z.strictObject({day:z.iso.date(),groupId:group,variantId:z.string().min(1).max(180),captionSha256:hash,imageSha256:hash,actorProfileId:profile,
 state:z.enum(["ready","submitted","moderator_pending","published_verified","failed","unknown","skipped","complaint","removed"]),createdAt:instant,postUrl,
 publicationEvidence:z.enum(["operator_recorded_readback","unverified"])});
const historyItem=z.strictObject({id:hash,groupId:group,contentDigest:hash,variantId:z.string().min(1).max(180).nullable(),identity:z.string().min(1).max(200),state:z.string().min(1).max(100),recordedAt:instant,postUrl,
 publicationEvidence:z.enum(["browser_readback","unverified"])});
function exactGroupUrl(url:string,id:string,post:boolean){try{
 const u=new URL(url);if(u.protocol!=="https:"||u.hostname!=="www.facebook.com"||u.port||u.username||u.password||u.search||u.hash)return false;
 const prefix=`/groups/${id}/`;
 return post?u.pathname.startsWith(prefix)&&/^(?:posts|permalink)\/[0-9]+\/?$/.test(u.pathname.slice(prefix.length)):u.pathname===`/groups/${id}`;
}catch{return false;}}
/** This is evidence only: no endpoint or publication capability is implied. */
export const fishingMarketingLegacySnapshotSchema=z.strictObject({schemaVersion:z.literal(1),program:z.literal("fishing"),channel:z.literal("facebook_group_manual"),mode:z.literal("assisted"),generatedAt:instant,
 schedule:z.strictObject({timezone,dailyCap:z.number().int().min(1).max(5),cooldownDays:z.number().int().min(1).max(365),enabled:z.boolean(),funnelReady:z.boolean(),
  day:z.iso.date(),window:z.enum(["waiting","due","missed"]),nextDue:instant,lastRun:z.strictObject({day:z.iso.date(),state:z.string().min(1).max(40),started_at:instant}).nullable()}),
 assets:z.array(asset).max(50),targets:z.array(target).max(1000),items:z.array(queueItem).max(2000),itemsTruncated:z.boolean(),history:z.array(historyItem).max(2000),historyAvailable:z.boolean(),historyTruncated:z.boolean(),excludedHistory:z.number().int().min(0).max(2000)
}).superRefine((value,ctx)=>{
 const invalid=(path:(string|number)[])=>ctx.addIssue({code:"custom",path,message:"inconsistent Fishing evidence"});
 if(new Set(value.assets.map(a=>a.id)).size!==value.assets.length)invalid(["assets"]);
 if(new Set(value.targets.map(t=>t.id)).size!==value.targets.length)invalid(["targets"]);
 value.targets.forEach((t,i)=>{if(!exactGroupUrl(t.url,t.id,false))invalid(["targets",i,"url"]);
  const r=t.review;if(r){
   if(r.rulesUrl!==`https://www.facebook.com/groups/${t.id}/about`)invalid(['targets',i,'review','rulesUrl']);
   if(Date.parse(r.rulesCheckedAt)>Date.parse(value.generatedAt)||r.membershipVerifiedAt&&Date.parse(r.membershipVerifiedAt)>Date.parse(value.generatedAt))invalid(['targets',i,'review','rulesCheckedAt']);
   if(r.cooldownDays<Math.max(7,value.schedule.cooldownDays))invalid(['targets',i,'review','cooldownDays']);
   if(t.eligible&&(!r.promotionAllowed||!r.membershipVerifiedAt))invalid(['targets',i,'review']);
   if(t.preparation&&(Date.parse(r.rulesCheckedAt)!==Date.parse(t.preparation.rulesCheckedAt??'')||!r.promotionAllowed&&t.preparation.canPrepare))invalid(['targets',i,'review']);
  }
  const p=t.preparation;if(!p)return;
  if(!value.historyAvailable&&(p.status==='ready'||p.status==='cooldown'||p.canPrepare))invalid(['targets',i,'preparation','status']);
  if(p.canPrepare!==(p.status==='ready'&&t.eligible&&t.hold===null&&value.schedule.enabled&&value.schedule.funnelReady))invalid(['targets',i,'preparation','canPrepare']);
  if((p.status==='cooldown')!==(p.nextEligibleAt!==null)||p.nextEligibleAt&&Date.parse(p.nextEligibleAt)<=Date.parse(value.generatedAt))invalid(['targets',i,'preparation','nextEligibleAt']);
  if((p.status==='ready'||p.status==='cooldown')&&!p.rulesCheckedAt)invalid(['targets',i,'preparation','rulesCheckedAt']);
  if(p.rulesCheckedAt&&Date.parse(p.rulesCheckedAt)>Date.parse(value.generatedAt))invalid(['targets',i,'preparation','rulesCheckedAt']);
  if(p.lastPublishedAt&&Date.parse(p.lastPublishedAt)>Date.parse(value.generatedAt))invalid(['targets',i,'preparation','lastPublishedAt']);
 });
 value.items.forEach((item,i)=>{if(item.postUrl&&!exactGroupUrl(item.postUrl,item.groupId,true))invalid(["items",i,"postUrl"]);
  if(item.publicationEvidence==="operator_recorded_readback"&&(item.state!=="published_verified"||!item.postUrl))invalid(["items",i,"publicationEvidence"]);});
 value.history.forEach((item,i)=>{if(item.postUrl&&!exactGroupUrl(item.postUrl,item.groupId,true))invalid(["history",i,"postUrl"]);
  if(item.publicationEvidence==="browser_readback"&&(item.state!=="published_browser_readback_verified"||!item.postUrl))invalid(["history",i,"publicationEvidence"]);});
 if(!value.historyAvailable&&(value.history.length||value.historyTruncated||value.excludedHistory))invalid(["historyAvailable"]);
});


const campaignTarget=z.strictObject({
 id:group,name:z.string().max(200),url:z.url(),eligible:z.boolean(),hold:z.literal('review').nullable(),
 // Legacy evidence remains readable, but cannot be supplied as current campaign evidence.
 preparation:z.never().optional(),review:z.never().optional(),
 campaign:z.strictObject({
  status:z.enum(['due','cooldown','held','reconcile','outside_window','other_weekday','closed_weekday','refresh_rules','review_cadence','account_held','account_guard_unknown']),
  placement:z.enum(['post','thread','hold']),minimumGapDays:z.number().int().min(2).max(365),interval:z.enum(['calendar_days','rolling_days','unknown']),
  advertisingDays:z.array(z.number().int().min(0).max(6)).max(7),closedDays:z.array(z.number().int().min(0).max(6)).max(7),
  rulesCheckedAt:instant,rulesUrl:z.url(),ruleSummary:z.string().min(1).max(4000),
  visibility:z.enum(['public','private','unknown','inaccessible']),permission:z.enum(['explicit','public_no_restrictions','unknown','prohibited']),
  moderation:z.enum(['not_observed','approval_required','unknown']),complete:z.boolean(),nextEligibleAt:instant.nullable(),lastAttemptAt:instant.nullable()
 })
});
/** Local publisher evidence; receiving it never grants hosted publication control. */
export const fishingMarketingLocalSnapshotSchema=z.strictObject({
 schemaVersion:z.literal(2),program:z.literal('fishing'),channel:z.literal('facebook_group_personal'),mode:z.literal('local_playwright'),generatedAt:instant,
 schedule:z.strictObject({timezone:z.literal('America/New_York'),dailyCap:z.null(),cooldownDays:z.null(),enabled:z.boolean(),funnelReady:z.boolean(),
  day:z.iso.date(),window:z.enum(['waiting','due','missed']),nextDue:instant,lastRun:z.null(),startHour:z.literal(10),endHour:z.literal(18),wakeHours:z.tuple([z.literal(10),z.literal(14)])}),
 worker:z.strictObject({
  publisher:z.enum(['idle','busy','unknown']),slot:z.union([z.enum(['open','reconcile_submission','account_held','account_guard_unknown']),instant]),
  account:z.strictObject({state:z.enum(['clear','cleared','held','unknown']),reason:z.string().min(1).max(100).nullable(),detectedAt:instant.nullable()}),
  login:z.strictObject({state:z.enum(['verified','needs_login','unknown']),checkedAt:instant.nullable()}),
  lastRun:z.strictObject({id:z.string().min(1).max(80),startedAt:instant,evidenceAt:instant,endedAt:instant.nullable(),
   state:z.enum(['running','finished','needs_action','stopped','interrupted']),reason:z.string().min(1).max(100).nullable(),groupId:group.nullable()}).nullable(),
  lastSuccessfulRunAt:instant.nullable(),lastConfirmedPublicationAt:instant.nullable(),nextWakeAt:instant
 }),
 creative:z.strictObject({captions:z.array(z.strictObject({language:z.enum(['en','he']),caption:z.string().min(1).max(5000),sha256:hash,sourceSha256:hash})).length(2),
  video:z.strictObject({kind:z.literal('video'),sha256:hash,verifiedAt:instant})}),
 assets:z.array(asset).max(0),targets:z.array(campaignTarget).max(1000),items:z.array(queueItem).max(0),itemsTruncated:z.literal(false),
 history:z.array(historyItem).max(2000),historyAvailable:z.literal(true),historyTruncated:z.boolean(),excludedHistory:z.number().int().min(0).max(2000)
}).superRefine((value,ctx)=>{
 const invalid=(path:(string|number)[])=>ctx.addIssue({code:'custom',path,message:'inconsistent local Fishing evidence'});
 const at=Date.parse(value.generatedAt),notFuture=(date:string|null,path:(string|number)[])=>{if(date&&Date.parse(date)>at)invalid(path);};
 if(new Set(value.targets.map(t=>t.id)).size!==value.targets.length)invalid(['targets']);
 if(new Set(value.history.map(h=>h.id)).size!==value.history.length)invalid(['history']);
 if(new Set(value.creative.captions.map(c=>c.language)).size!==2)invalid(['creative','captions']);
 notFuture(value.creative.video.verifiedAt,['creative','video','verifiedAt']);
 if(value.schedule.nextDue!==value.worker.nextWakeAt||Date.parse(value.schedule.nextDue)<at)invalid(['schedule','nextDue']);
 const w=value.worker;
 notFuture(w.account.detectedAt,['worker','account','detectedAt']);notFuture(w.login.checkedAt,['worker','login','checkedAt']);
 notFuture(w.lastSuccessfulRunAt,['worker','lastSuccessfulRunAt']);notFuture(w.lastConfirmedPublicationAt,['worker','lastConfirmedPublicationAt']);
 if(w.login.state==='verified'&&(!w.login.checkedAt||at-Date.parse(w.login.checkedAt)>15*60_000||w.account.state==='held'||w.account.state==='unknown'))invalid(['worker','login']);
 if(w.login.state==='needs_login'&&(w.account.state!=='held'||!['account_checkpoint','identity_review'].includes(w.account.reason??'')))invalid(['worker','login']);
 if(w.lastRun){
  const r=w.lastRun;
  notFuture(r.evidenceAt,['worker','lastRun','evidenceAt']);notFuture(r.endedAt,['worker','lastRun','endedAt']);
  if(Date.parse(r.startedAt)>Date.parse(r.evidenceAt)||r.endedAt&&(Date.parse(r.endedAt)<Date.parse(r.startedAt)||Date.parse(r.endedAt)>Date.parse(r.evidenceAt)))invalid(['worker','lastRun']);
  if(r.state==='running'&&r.endedAt!==null)invalid(['worker','lastRun','endedAt']);
 }
 value.targets.forEach((target,i)=>{
  const c=target.campaign,path=['targets',i,'campaign'];
  if(!exactGroupUrl(target.url,target.id,false))invalid(['targets',i,'url']);
  if(c.rulesUrl!==`https://www.facebook.com/groups/${target.id}/about`)invalid([...path,'rulesUrl']);
  notFuture(c.rulesCheckedAt,[...path,'rulesCheckedAt']);notFuture(c.lastAttemptAt,[...path,'lastAttemptAt']);
  if(new Set(c.advertisingDays).size!==c.advertisingDays.length||new Set(c.closedDays).size!==c.closedDays.length)invalid(path);
  if(target.eligible&&(!c.complete||target.hold!==null||c.placement==='hold'||!['public','private'].includes(c.visibility)||!['explicit','public_no_restrictions'].includes(c.permission)||c.permission==='public_no_restrictions'&&c.visibility!=='public'||c.moderation!=='not_observed'||c.interval==='unknown'))invalid(['targets',i,'eligible']);
  if(c.status==='due'&&(!target.eligible||!value.schedule.enabled||!value.schedule.funnelReady||!['clear','cleared'].includes(w.account.state)))invalid([...path,'status']);
  if(c.nextEligibleAt&&(!target.eligible||!['due','cooldown','outside_window','closed_weekday','other_weekday'].includes(c.status)||Date.parse(c.nextEligibleAt)<at))invalid([...path,'nextEligibleAt']);
 });
 value.history.forEach((item,i)=>{
  notFuture(item.recordedAt,['history',i,'recordedAt']);
  if(item.postUrl&&!exactGroupUrl(item.postUrl,item.groupId,true))invalid(['history',i,'postUrl']);
  if(item.publicationEvidence==='browser_readback'&&(item.state!=='published_browser_readback_verified'||!item.postUrl))invalid(['history',i,'publicationEvidence']);
 });
});
export const fishingMarketingSnapshotSchema=z.union([fishingMarketingLegacySnapshotSchema,fishingMarketingLocalSnapshotSchema]);
export type FishingMarketingLocalSnapshot=z.infer<typeof fishingMarketingLocalSnapshotSchema>;
export type FishingMarketingSnapshot=z.infer<typeof fishingMarketingSnapshotSchema>;
