import {z} from "zod";

const group=z.string().regex(/^[A-Za-z0-9._-]{1,150}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.iso.datetime({offset:true});
const timezone=z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}});
const profile=z.string().regex(/^[0-9]{5,32}$/).nullable();
const postUrl=z.url().nullable();
const target=z.strictObject({id:group,name:z.string().max(200),url:z.url(),eligible:z.boolean(),hold:z.enum(["complaint","removed"]).nullable()});
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
export const fishingMarketingSnapshotSchema=z.strictObject({schemaVersion:z.literal(1),program:z.literal("fishing"),channel:z.literal("facebook_group_manual"),mode:z.literal("assisted"),generatedAt:instant,
 schedule:z.strictObject({timezone,dailyCap:z.number().int().min(1).max(5),cooldownDays:z.number().int().min(1).max(365),enabled:z.boolean(),funnelReady:z.boolean(),
  day:z.iso.date(),window:z.enum(["waiting","due","missed"]),nextDue:instant,lastRun:z.strictObject({day:z.iso.date(),state:z.string().min(1).max(40),started_at:instant}).nullable()}),
 assets:z.array(asset).max(50),targets:z.array(target).max(1000),items:z.array(queueItem).max(2000),itemsTruncated:z.boolean(),history:z.array(historyItem).max(2000),historyAvailable:z.boolean(),historyTruncated:z.boolean(),excludedHistory:z.number().int().min(0).max(2000)
}).superRefine((value,ctx)=>{
 const invalid=(path:(string|number)[])=>ctx.addIssue({code:"custom",path,message:"inconsistent Fishing evidence"});
 if(new Set(value.assets.map(a=>a.id)).size!==value.assets.length)invalid(["assets"]);
 if(new Set(value.targets.map(t=>t.id)).size!==value.targets.length)invalid(["targets"]);
 value.targets.forEach((t,i)=>{if(!exactGroupUrl(t.url,t.id,false))invalid(["targets",i,"url"]);});
 value.items.forEach((item,i)=>{if(item.postUrl&&!exactGroupUrl(item.postUrl,item.groupId,true))invalid(["items",i,"postUrl"]);
  if(item.publicationEvidence==="operator_recorded_readback"&&(item.state!=="published_verified"||!item.postUrl))invalid(["items",i,"publicationEvidence"]);});
 value.history.forEach((item,i)=>{if(item.postUrl&&!exactGroupUrl(item.postUrl,item.groupId,true))invalid(["history",i,"postUrl"]);
  if(item.publicationEvidence==="browser_readback"&&(item.state!=="published_browser_readback_verified"||!item.postUrl))invalid(["history",i,"publicationEvidence"]);});
 if(!value.historyAvailable&&(value.history.length||value.historyTruncated||value.excludedHistory))invalid(["historyAvailable"]);
});
export type FishingMarketingSnapshot=z.infer<typeof fishingMarketingSnapshotSchema>;
