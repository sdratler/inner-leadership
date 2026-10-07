import type {MarketingSnapshot,Publication} from '../../../src/features/marketing-overview/contracts.ts';
export const contentReadAt='2026-10-05T19:00:00.000Z';
export function contentPublication(patch:Partial<Publication>={}):Publication{
 return{id:'DEMO-status-1',assetId:'DEMO-content',creativeRevision:3,creativeDigest:'b'.repeat(64),channel:'whatsapp_status',destinationLabel:'Synthetic private fixture',scheduledFor:'2026-10-05T17:00:00.000Z',timezone:'Asia/Jerusalem',state:'scheduled',provider:'whapi',providerReceiptId:null,providerReadAt:null,postUrl:null,receiptKind:'unknown',manualReportedAt:null,errorCode:null,...patch};
}
export function contentSnapshot(publications:Publication[]=[contentPublication()]):MarketingSnapshot{
 return{source:'registry_only',fetchedAt:contentReadAt,creatives:[{assetId:'DEMO-content',revision:3,contentDigest:'b'.repeat(64),registeredRevision:true,locale:'he',width:1080,height:1920,imageUrl:null,title:'DEMO — existing Hebrew content',caption:'Synthetic caption must not enter Calendar DTO',review:'approved',approvedDigest:'b'.repeat(64)}],publications,ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'},inventory:{files:1,concepts:1,publishablePosts:1,heStatusReady:1,heFeedReady:0,enFeedReady:0,adEligible:0,inLiveAds:null,queued:1,published:0,needsApproval:0,needsResizeOrCaption:0,heldMissing:0,partial:true,asOf:contentReadAt}};
}
