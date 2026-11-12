import {fishingMarketingLocalSnapshotSchema} from '../../src/features/fishing-marketing/contract.ts';
/** Synthetic content only; never a live group, profile, creative or delivery fixture. */
export function localMarketingFixture(){
 const at='2026-11-10T15:00:00Z',before='2026-11-10T14:59:00Z',hash='a'.repeat(64);
 return fishingMarketingLocalSnapshotSchema.parse({
  schemaVersion:2,program:'fishing',channel:'facebook_group_personal',mode:'local_playwright',generatedAt:at,
  schedule:{timezone:'America/New_York',dailyCap:null,cooldownDays:null,enabled:true,funnelReady:true,day:'2026-11-10',window:'due',nextDue:at,lastRun:null,startHour:10,endHour:18,wakeHours:[10,14]},
  worker:{publisher:'idle',slot:'open',account:{state:'clear',reason:null,detectedAt:null},login:{state:'unknown',checkedAt:null},lastRun:null,lastSuccessfulRunAt:null,lastConfirmedPublicationAt:before,nextWakeAt:at},
  creative:{captions:[{language:'en',caption:'Synthetic approved English text <script>private</script>',sha256:hash,sourceSha256:hash},{language:'he',caption:'טקסט מאושר לדוגמה בלבד',sha256:hash,sourceSha256:hash}],video:{kind:'video',sha256:hash,verifiedAt:at}},
  assets:[],targets:[{id:'123',name:'Synthetic reviewed group',url:'https://www.facebook.com/groups/123',eligible:true,hold:null,
   campaign:{status:'due',placement:'post',minimumGapDays:2,interval:'calendar_days',advertisingDays:[],closedDays:[5],rulesCheckedAt:before,rulesUrl:'https://www.facebook.com/groups/123/about',ruleSummary:'Synthetic rule <img src=x onerror=alert(1)>',visibility:'public',permission:'public_no_restrictions',moderation:'not_observed',complete:true,nextEligibleAt:at,lastAttemptAt:null}}],
  items:[],itemsTruncated:false,
  history:[
   {id:'1'.repeat(64),groupId:'991',contentDigest:hash,variantId:'pinned-program-en',identity:'personal',state:'published_browser_readback_verified',recordedAt:before,postUrl:'https://www.facebook.com/groups/991/posts/456',publicationEvidence:'browser_readback'},
   {id:'2'.repeat(64),groupId:'992',contentDigest:hash,variantId:'pinned-program-en',identity:'personal',state:'pending_admin_approval',recordedAt:before,postUrl:null,publicationEvidence:'unverified'},
   {id:'3'.repeat(64),groupId:'993',contentDigest:hash,variantId:'pinned-program-he',identity:'personal',state:'declined_by_group',recordedAt:before,postUrl:null,publicationEvidence:'unverified'},
   {id:'4'.repeat(64),groupId:'994',contentDigest:hash,variantId:'pinned-program-he',identity:'personal',state:'submission_unknown',recordedAt:before,postUrl:null,publicationEvidence:'unverified'}
  ],historyAvailable:true,historyTruncated:false,excludedHistory:0
 });
}
