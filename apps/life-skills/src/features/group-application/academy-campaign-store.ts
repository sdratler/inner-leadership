import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {one,type SqlSession} from '../identity/store.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {ACADEMY_CAMPAIGN,PREREG_CREATIVE,academyCampaignTarget,campaignSnapshotSchema,campaignShareCommandSchema,type CampaignSnapshot,type CampaignAttribution,type CampaignShareCommand,type AcademyOrganicCaptionReview} from './academy-campaign-contract.ts';
import {academyOrganicSource,academyOrganicCaption,organicCaptionMatches} from './academy-organic-captions.ts';
type Share={captionSource?:{fileId:string;bankRevision:string;bankSha256:string;sourceId:string};id:string;templateId?:string;templateSuperseded?:boolean;phase:CampaignSnapshot['phase'];placement:string;language:string;captionId:string;captionVersion:number;captionSha256:string;creative:typeof PREREG_CREATIVE;targetUrl:string;captionApproval:'UNVERIFIED_EXISTING_COPY_WORKFLOW_REQUIRED';status:string;snapshot:CampaignSnapshot;history:{action:string;at:string;actor:string;reason?:string;postUrl?:string;fromRevision?:number;toRevision?:number}[];needsReview:boolean;publication?:{method:'OWNER_MANUAL_CONFIRMATION';publishedAt:string;recordedAt:string;lastVerifiedAt:string;actor:string;evidence:string;postUrl?:string}};
export class AcademyCampaignStore{
 constructor(private workspace:WorkspaceId,private ring:Keyring,private key:string,private now:()=>Date){}
 private aad(id:string){return `academy/campaign/v1/${this.workspace}/${id}`;}
 private hash(v:unknown){return privateDigest({domain:'academy-campaign-v1',workspace:this.workspace,value:v},this.key);}
 private captionCurrent(p:Pick<Share,'captionId'|'captionVersion'|'captionSha256'|'language'>){
  if(!p.captionId.startsWith('jlfa-ls-'))return true;
  const caption=academyOrganicCaption(p.captionId);if('id'in p){const source=(p as Share).captionSource;if(!source||source.fileId!==academyOrganicSource.sourceFileId||source.bankRevision!==academyOrganicSource.bankRevision||source.bankSha256!==academyOrganicSource.bankSha256||source.sourceId!==caption?.sourceId)return false;}return Boolean(caption&&organicCaptionMatches(p)&&createHash('sha256').update(caption.text,'utf8').digest('hex')===p.captionSha256&&academyOrganicSource.creativeSha256===PREREG_CREATIVE.sha256);
 }
 captionReview():AcademyOrganicCaptionReview{return {bankDocumentId:academyOrganicSource.bankDocumentId,sourceContentVersion:academyOrganicSource.sourceContentVersion,captions:academyOrganicSource.captions};}
 private currentShare(p:Share){return this.captionCurrent(p)&&['en','he'].includes(p.language)&&['facebook_feed','whatsapp_status','whatsapp_message'].includes(p.placement)&&Object.entries(PREREG_CREATIVE).every(([key,value])=>p.creative[key as keyof typeof PREREG_CREATIVE]===value)&&p.targetUrl===academyCampaignTarget(p.language as 'en'|'he',p.placement as 'facebook_feed'|'whatsapp_status'|'whatsapp_message');}
 async initialize(tx:SqlSession){const row=await one(tx,'SELECT workspace_id FROM ls_service_interest.academy_campaigns WHERE workspace_id=$1',[this.workspace]);if(row)return;
  const prior=await one<{n:number}>(tx,'SELECT count(*)::int AS n FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1',[this.workspace]);if(!prior||prior.n!==0)throw new AppError('UNAVAILABLE');
  await tx.query('INSERT INTO ls_service_interest.academy_campaigns(workspace_id,version,revision,first_filled_at) VALUES($1,$2,0,NULL)',[this.workspace,ACADEMY_CAMPAIGN]);
 }
 async snapshot(tx:SqlSession):Promise<CampaignSnapshot>{
  const r=await one<{version:string|null;revision:number|null;firstFilledAt:Date|null;n:number;families:number}>(tx,`SELECT c.version,c.revision,c.first_filled_at AS "firstFilledAt",(SELECT count(*)::int FROM ls_service_interest.academy_founder_families f WHERE f.workspace_id=$1 AND allocated=true) AS n,(SELECT count(*)::int FROM ls_service_interest.academy_founder_families f WHERE f.workspace_id=$1) AS families FROM (SELECT $1::uuid AS workspace_id) w LEFT JOIN ls_service_interest.academy_campaigns c ON c.workspace_id=w.workspace_id`,[this.workspace]);
  if(!r||r.version===null&&r.families!==0||r.version!==null&&r.version!==ACADEMY_CAMPAIGN)throw new AppError('UNAVAILABLE');
  return campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,revision:r.revision??0,phase:r.firstFilledAt?'REGULAR_REGISTRATION':'PRE_REGISTRATION',firstFilledAt:r.firstFilledAt?.toISOString()??null,capacity:30,occupied:r.n,remaining:30-r.n,asOf:this.now().toISOString(),reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
 }
 async allocationChanged(tx:SqlSession){await tx.query(`UPDATE ls_service_interest.academy_campaigns SET revision=revision+1,first_filled_at=CASE WHEN first_filled_at IS NULL AND (SELECT count(*) FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1 AND allocated=true)=30 THEN $2 ELSE first_filled_at END WHERE workspace_id=$1`,[this.workspace,this.now()]);const s=await this.snapshot(tx);
  const rows=await tx.query<{id:string;payload:string}>('SELECT id,payload_ciphertext AS payload FROM ls_service_interest.academy_campaign_shares WHERE workspace_id=$1 ORDER BY created_at,id FOR UPDATE',[this.workspace]);
  const shares=rows.map(row=>JSON.parse(unseal(row.payload,this.aad(row.id),this.ring)) as Share),templates=new Map<string,Share>();
  for(const p of shares){if(p.phase!=='PRE_REGISTRATION')continue;
   if(!this.captionCurrent(p)){p.needsReview=true;if(['prepared','copied','exported'].includes(p.status))p.status='superseded';await this.writeShare(tx,p);continue;}
   const key=p.placement+'\0'+p.language,prior=templates.get(key);
   if(!p.templateSuperseded&&!['superseded','withdrawn'].includes(p.status)&&(!prior||prior.status==='manual_confirmed_published'||p.status!=='manual_confirmed_published'))templates.set(key,p);
   if(s.phase==='REGULAR_REGISTRATION'&&(['prepared','copied','exported'].includes(p.status)||p.status==='manual_confirmed_published'&&!p.needsReview)){
    if(p.status==='manual_confirmed_published')p.needsReview=true;else p.status='superseded';
    p.history.push({action:'allocation_phase_closed',at:s.asOf,actor:'system:campaign-allocation',fromRevision:p.snapshot.revision,toRevision:s.revision});await this.writeShare(tx,p);
   }
  }
  // No caption or channel is invented. Only an existing manually bound
  // evergreen template can be refreshed; approval remains explicitly unverified.
  // Phase B has no admitted regular asset, so it must not prepare a substitute.
  if(s.phase!=='PRE_REGISTRATION')return;
  for(const template of templates.values()){
   if(!['en','he'].includes(template.language)||!['facebook_feed','whatsapp_status','whatsapp_message'].includes(template.placement)||template.creative.sha256!==PREREG_CREATIVE.sha256||template.creative.id!==PREREG_CREATIVE.id)continue;
   const targetUrl=academyCampaignTarget(template.language as 'en'|'he',template.placement as 'facebook_feed'|'whatsapp_status'|'whatsapp_message');
   const pending=shares.filter(p=>p.placement===template.placement&&p.language===template.language&&['prepared','copied','exported'].includes(p.status));
   const next=pending.find(p=>p.status==='prepared'&&p.captionId===template.captionId&&p.captionVersion===template.captionVersion&&p.captionSha256===template.captionSha256);
   for(const p of pending){if(p===next)continue;p.status='superseded';p.history.push({action:'allocation_preparation_superseded',at:s.asOf,actor:'system:campaign-allocation',fromRevision:p.snapshot.revision,toRevision:s.revision});await this.writeShare(tx,p);}
   if(next){const fromRevision=next.snapshot.revision;next.snapshot=s;next.targetUrl=targetUrl;next.history.push({action:'allocation_preparation_refreshed',at:s.asOf,actor:'system:campaign-allocation',fromRevision,toRevision:s.revision});await this.writeShare(tx,next);}
   else{const fresh:Share={...template,id:randomUUID(),templateId:template.templateId??template.id,targetUrl,status:'prepared',snapshot:s,needsReview:false,history:[{action:'allocation_preparation_created',at:s.asOf,actor:'system:campaign-allocation',fromRevision:template.snapshot.revision,toRevision:s.revision}]};delete fresh.publication;await this.insertShare(tx,fresh);}
  }
 }
 /** Immutable per-operation touch; checked even for cached application replies. */
 async attribution(tx:SqlSession,operationId:string,applicationId:string,attribution:CampaignAttribution|null){const digest=this.hash(attribution),old=await one<{digest:string}>(tx,'SELECT request_digest AS digest FROM ls_service_interest.academy_campaign_touches WHERE workspace_id=$1 AND operation_id=$2',[this.workspace,operationId]);if(old){if(old.digest!==digest)throw new AppError('CONFLICT');return;}await tx.query('INSERT INTO ls_service_interest.academy_campaign_touches(workspace_id,operation_id,application_id,request_digest,payload_ciphertext,at) VALUES($1,$2,$3,$4,$5,$6)',[this.workspace,operationId,applicationId,digest,seal(JSON.stringify(attribution),this.aad(operationId),this.ring),this.now()]);}
 async checkAttribution(tx:SqlSession,operationId:string,attribution:CampaignAttribution|null){const old=await one<{digest:string}>(tx,'SELECT request_digest AS digest FROM ls_service_interest.academy_campaign_touches WHERE workspace_id=$1 AND operation_id=$2',[this.workspace,operationId]);if(old&&old.digest!==this.hash(attribution)||!old&&attribution!==null)throw new AppError('CONFLICT');}
 private async writeShare(tx:SqlSession,p:Share){await tx.query('UPDATE ls_service_interest.academy_campaign_shares SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[this.workspace,p.id,seal(JSON.stringify(p),this.aad(p.id),this.ring)]);}
 private async insertShare(tx:SqlSession,p:Share){await tx.query('INSERT INTO ls_service_interest.academy_campaign_shares(workspace_id,id,payload_ciphertext,created_at) VALUES($1,$2,$3,$4)',[this.workspace,p.id,seal(JSON.stringify(p),this.aad(p.id),this.ring),this.now()]);}
 async list(tx:SqlSession){const rows=await tx.query<{id:string;payload:string}>('SELECT id,payload_ciphertext AS payload FROM ls_service_interest.academy_campaign_shares WHERE workspace_id=$1 ORDER BY created_at,id',[this.workspace]);return rows.map(r=>JSON.parse(unseal(r.payload,this.aad(r.id),this.ring)) as Share);}
 async attributionSummary(tx:SqlSession,qualifyingFamilyIds:readonly string[]){const rows=await tx.query<{family:string;payload:string;operation:string;allocated:boolean}>('SELECT a.family_id AS family,t.payload_ciphertext AS payload,t.operation_id AS operation,f.allocated FROM ls_service_interest.academy_campaign_touches t JOIN ls_service_interest.academy_founder_applications a ON a.workspace_id=t.workspace_id AND a.application_id=t.application_id JOIN ls_service_interest.academy_founder_families f ON f.workspace_id=a.workspace_id AND f.id=a.family_id WHERE t.workspace_id=$1 ORDER BY t.touch_sequence',[this.workspace]);const families=new Map<string,{first:CampaignAttribution['first'];last:CampaignAttribution['last'];allocated:boolean}>();for(const row of rows){const touch=JSON.parse(unseal(row.payload,this.aad(row.operation),this.ring)) as CampaignAttribution|null;if(touch){const prior=families.get(row.family);families.set(row.family,{first:prior?.first??touch.first,last:touch.last,allocated:row.allocated});}}const unresolved=[...families.keys()].filter(id=>!qualifyingFamilyIds.includes(id)).length;for(const id of families.keys())if(!qualifyingFamilyIds.includes(id))families.delete(id);return {unresolvedAttributedRecords:unresolved,attributedUniqueFamilies:families.size,attributedAllocatedFamilies:[...families.values()].filter(f=>f.allocated).length,byFirstSource:Object.fromEntries(['facebook','whatsapp','website','direct'].map(source=>[source,[...families.values()].filter(f=>f.first.source===source).length])),byLastSource:Object.fromEntries(['facebook','whatsapp','website','direct'].map(source=>[source,[...families.values()].filter(f=>f.last.source===source).length]))};}
 async execute(tx:SqlSession,actor:string,input:CampaignShareCommand){const c=campaignShareCommandSchema.parse(input),digest=this.hash(c),old=await one<{digest:string;result:string}>(tx,'SELECT request_digest AS digest,result_ciphertext AS result FROM ls_service_interest.academy_campaign_operations WHERE workspace_id=$1 AND operation_id=$2 AND actor_id=$3',[this.workspace,c.operationId,actor]);if(old){if(old.digest!==digest)throw new AppError('CONFLICT');return JSON.parse(unseal(old.result,this.aad(c.operationId),this.ring)) as Share;}
  const snapshot=await this.snapshot(tx);let p:Share;
  if(c.action==='prepare_share'){
   if(snapshot.phase!=='PRE_REGISTRATION')throw new AppError('UNAVAILABLE');if(!this.captionCurrent(c))throw new AppError('CONFLICT');
   for(const existing of (await this.list(tx)).filter(p=>p.placement===c.placement&&p.language===c.language&&!p.templateSuperseded)){existing.templateSuperseded=true;if(['prepared','copied','exported'].includes(existing.status))existing.status='superseded';existing.history.push({action:'template_replaced',at:snapshot.asOf,actor});await this.writeShare(tx,existing);}
   p={...(academyOrganicCaption(c.captionId)?{captionSource:{fileId:academyOrganicSource.sourceFileId,bankRevision:academyOrganicSource.bankRevision,bankSha256:academyOrganicSource.bankSha256,sourceId:academyOrganicCaption(c.captionId)!.sourceId}}:{}),id:randomUUID(),phase:snapshot.phase,placement:c.placement,language:c.language,captionId:c.captionId,captionVersion:c.captionVersion,captionSha256:c.captionSha256,creative:PREREG_CREATIVE,targetUrl:academyCampaignTarget(c.language,c.placement),captionApproval:'UNVERIFIED_EXISTING_COPY_WORKFLOW_REQUIRED',status:'prepared',snapshot,history:[{action:c.action,at:this.now().toISOString(),actor}],needsReview:false};await this.insertShare(tx,p);
  }else{const row=await one<{payload:string}>(tx,'SELECT payload_ciphertext AS payload FROM ls_service_interest.academy_campaign_shares WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspace,c.shareId]);if(!row)throw new AppError('NOT_FOUND');p=JSON.parse(unseal(row.payload,this.aad(c.shareId),this.ring)) as Share;
   if(['copy_share','export_share'].includes(c.action)&&(snapshot.phase!==p.phase||p.templateSuperseded||!this.currentShare(p)||['superseded','withdrawn','manual_confirmed_published'].includes(p.status)))throw new AppError('CONFLICT');
   if(c.postUrl&&!/^https:\/\/(?:www\.)?(?:facebook\.com|wa\.me)\//.test(c.postUrl))throw new AppError('INVALID_REQUEST');
   if(c.action==='withdraw_share'){p.templateSuperseded=true;for(const sibling of await this.list(tx)){if(sibling.id!==p.id&&(sibling.templateId??sibling.id)===(p.templateId??p.id)){sibling.templateSuperseded=true;if(['prepared','copied','exported'].includes(sibling.status))sibling.status='superseded';sibling.history.push({action:'template_withdrawn',at:snapshot.asOf,actor,reason:c.reason});await this.writeShare(tx,sibling);}}}
   if(c.action==='confirm_manual_publication'){
    if(new Date(c.publishedAt)>this.now()||new Date(c.publishedAt)<new Date(p.history[0]!.at)||['withdrawn'].includes(p.status))throw new AppError('INVALID_REQUEST');
    if(p.publication)throw new AppError('CONFLICT');
    p.publication={method:'OWNER_MANUAL_CONFIRMATION',publishedAt:c.publishedAt,recordedAt:snapshot.asOf,lastVerifiedAt:snapshot.asOf,actor,evidence:c.reason,...(c.postUrl?{postUrl:c.postUrl}:{})};
   }
   p.status=c.action==='confirm_manual_publication'?'manual_confirmed_published':c.action==='withdraw_share'?(p.status==='manual_confirmed_published'?p.status:'withdrawn'):c.action==='copy_share'?'copied':'exported';p.needsReview=p.needsReview||p.phase!==snapshot.phase||Boolean(p.templateSuperseded)||!this.currentShare(p);p.history.push({action:c.action,at:this.now().toISOString(),actor,reason:c.reason,...(c.postUrl?{postUrl:c.postUrl}:{})});await this.writeShare(tx,p);
  }
  await tx.query('INSERT INTO ls_service_interest.academy_campaign_operations(workspace_id,operation_id,actor_id,request_digest,result_ciphertext) VALUES($1,$2,$3,$4,$5)',[this.workspace,c.operationId,actor,digest,seal(JSON.stringify(p),this.aad(c.operationId),this.ring)]);return p;
 }
}
