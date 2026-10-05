import {beforeEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({registry:vi.fn(),meta:vi.fn()}));
vi.mock("../../../src/features/prospects/bridge.ts",()=>({crmBridge:mocks.registry}));
vi.mock("../../../src/features/marketing-overview/meta-provider.ts",()=>({readDirectMetaAds:mocks.meta}));
const readAt="2026-10-03T18:05:49.000Z",metaAt="2026-10-03T19:00:00.000Z";
const inventory=()=>({files:1,concepts:1,publishablePosts:0,heStatusReady:0,heFeedReady:0,enFeedReady:0,adEligible:0,inLiveAds:null,queued:0,published:0,needsApproval:1,needsResizeOrCaption:1,heldMissing:0,partial:true,asOf:readAt});
const publication=()=>({id:"synthetic-publication",assetId:"DEMO-image",creativeRevision:1,creativeDigest:"a".repeat(64),channel:"whatsapp_status",destinationLabel:"Synthetic Status",scheduledFor:null,timezone:"Asia/Jerusalem",state:"draft",provider:"unbound",providerReceiptId:null,providerReadAt:null,postUrl:null,receiptKind:"unknown",manualReportedAt:null,errorCode:null});
const registry=()=>({success:true,snapshot:{fetchedAt:readAt,workbookUrl:"https://docs.google.com/spreadsheets/d/synthetic/edit",creatives:[{assetId:"DEMO-image",revision:1,imageUrl:"https://drive.google.com/file/d/synthetic_file/view",sourceUrl:"https://drive.google.com/file/d/synthetic_file/view",contentDigest:"a".repeat(64),locale:"he",width:1080,height:1920,review:"in_review",approvedDigest:null,caption:"",title:"Synthetic original"}],publications:[],inventory:inventory()}});
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();mocks.registry.mockResolvedValue(registry());mocks.meta.mockResolvedValue({fetchedAt:metaAt,ads:[],adSeries:[],adReporting:{}});});

test("secondary originals/history retain a separate private exact collection and honest unregistered metadata",async()=>{
 const original={...registry().snapshot.creatives[0],collection:'templates',catalogKind:'NATIVE_ORIGINAL',concept:3,cycle:null,registeredRevisionLabel:'r1'},history={...original,assetId:'DEMO-history',collection:'history',review:'retired',approvedDigest:null};
 const legacy={...original,assetId:'DEMO-legacy',registeredRevision:false,registeredRevisionLabel:'20260911'};
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,library:[original,history,legacy]}});const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");const result=await loadMarketingSnapshot();
 expect(result.inventoryReadback?.status).toBe('available');expect(result.creatives).toHaveLength(1);expect(result.library).toHaveLength(3);expect(result.library?.[0]?.imageUrl).toContain('collection=templates');expect(result.library?.[1]?.imageUrl).toContain('collection=history');expect(result.library?.[2]).toMatchObject({imageUrl:null,registeredRevisionLabel:'20260911',cycle:null});
});

test.each([{collection:'current'},{collection:'history',review:'in_review'},{collection:'history',review:'retired',approvedDigest:'a'.repeat(64)},{collection:'templates',reviewToken:'a'.repeat(64)},{collection:'templates',catalogKind:'RAW_PHOTO'},{collection:'templates',concept:-1},{collection:'templates',cycle:'bad\ntext'}])("malformed secondary metadata cannot be a fresh catalog or acquire review/delivery eligibility: %j",async patch=>{
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,library:[{...registry().snapshot.creatives[0],...patch}]}});const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe('error');
});

test("an inherited optional catalog is not accepted and the existing combined thousand-record bound remains enforced",async()=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");const original=registry();original.snapshot=Object.assign(Object.create({library:[]}),original.snapshot);mocks.registry.mockResolvedValue(original);expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe('error');
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,library:Array.from({length:1000},()=>({...registry().snapshot.creatives[0],collection:'templates'}))}});expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe('error');
});
test("an explicitly unregistered revision stays visible but never produces an original-image request",async()=>{
 const asset={...registry().snapshot.creatives[0],registeredRevision:false};mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,creatives:[asset]}});
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");const snapshot=await loadMarketingSnapshot();
 expect(snapshot.inventoryReadback?.status).toBe("available");expect(snapshot.creatives[0]).toMatchObject({registeredRevision:false,imageUrl:null,assetId:asset.assetId,revision:asset.revision,sourceUrl:asset.sourceUrl});
});
test.each([undefined,null,"true",1,{}])("an invalid explicit registered-revision marker cannot become exact media evidence: %j",async registeredRevision=>{
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,creatives:[{...registry().snapshot.creatives[0],registeredRevision}]}});
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe("error");
});
test("an inherited registered-revision marker is not own source evidence",async()=>{
 const asset=Object.assign(Object.create({registeredRevision:true}),registry().snapshot.creatives[0]);mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,creatives:[asset]}});
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe("error");
});
test("inventory freshness belongs to inventory, not the newer direct-ad metric read",async()=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts"),snapshot=await loadMarketingSnapshot();
 expect(snapshot.inventoryReadback).toMatchObject({status:"available",lastSuccessfulReadAt:readAt,errorCode:null});expect(snapshot.fetchedAt).toBe(metaAt);expect(snapshot.creatives[0]?.imageUrl).toBe(`/api/marketing/assets/DEMO-image?revision=1&digest=${"a".repeat(64)}`);expect(snapshot.creatives[0]?.sourceUrl).toBe(registry().snapshot.creatives[0]?.sourceUrl);
});
test("failed inventory read retains only an honest last successful time, not stale assets or false empty-success",async()=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");await loadMarketingSnapshot();mocks.registry.mockRejectedValue(Error("unavailable"));
 const snapshot=await loadMarketingSnapshot();expect(snapshot.inventoryReadback).toMatchObject({status:"error",lastSuccessfulReadAt:readAt,errorCode:"creative_inventory_unavailable"});expect(snapshot.creatives).toEqual([]);expect(snapshot.connectionErrors).toContain("creative_inventory_unavailable");
});
test("Meta failure does not block the independent graphics inventory",async()=>{
 mocks.meta.mockRejectedValue(Error("unavailable"));const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts"),snapshot=await loadMarketingSnapshot();expect(snapshot.creatives).toHaveLength(1);expect(snapshot.inventoryReadback?.status).toBe("available");expect(snapshot.connectionErrors).toEqual(["direct_meta_readback_unavailable"]);
});
test("an older overlapping load cannot move successful inventory freshness backward",async()=>{
 const newerAt="2026-10-03T18:30:00.000Z";
 let releaseOlderMeta!:()=>void;
 const delayedMeta=new Promise(resolve=>{releaseOlderMeta=()=>resolve({fetchedAt:metaAt,ads:[],adSeries:[],adReporting:{}});});
 mocks.registry.mockResolvedValueOnce(registry()).mockResolvedValueOnce({success:true,snapshot:{...registry().snapshot,fetchedAt:newerAt}});
 mocks.meta.mockReturnValueOnce(delayedMeta);
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");
 const older=loadMarketingSnapshot();
 expect((await loadMarketingSnapshot()).inventoryReadback?.lastSuccessfulReadAt).toBe(newerAt);
 releaseOlderMeta();await older;
 mocks.registry.mockRejectedValueOnce(Error("unavailable"));
 const failed=await loadMarketingSnapshot();
 expect(failed.inventoryReadback).toMatchObject({status:"error",lastSuccessfulReadAt:newerAt});
 expect(failed.creatives).toEqual([]);
});
test.each([{success:false},{success:true,snapshot:{}},{success:true,snapshot:{...registry().snapshot,fetchedAt:"invalid"}},{success:true,snapshot:{...registry().snapshot,fetchedAt:null}},{success:true,snapshot:{...registry().snapshot,creatives:[null]}},{success:true,snapshot:{...registry().snapshot,creatives:Array(1001).fill(registry().snapshot.creatives[0])}}])("malformed inventory is unavailable without losing independent Meta data",async payload=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");await loadMarketingSnapshot();mocks.registry.mockResolvedValue(payload);
 const snapshot=await loadMarketingSnapshot();expect(snapshot.inventoryReadback).toMatchObject({status:"error",lastSuccessfulReadAt:readAt});expect(snapshot.creatives).toEqual([]);expect(snapshot.fetchedAt).toBe(metaAt);expect(snapshot.connectionErrors).toEqual(["creative_inventory_unavailable"]);
});
test.each([undefined,null,{},[],{...inventory(),files:undefined},{...inventory(),concepts:"1"},{...inventory(),queued:-1},{...inventory(),published:0.5},{...inventory(),inLiveAds:-1},{...inventory(),inLiveAds:"unknown"},{...inventory(),partial:"true"},{...inventory(),asOf:"invalid"},Object.create(inventory())])("incomplete or invalid inventory counts never become a fresh available read",async invalid=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");await loadMarketingSnapshot();
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,inventory:invalid}});
 const snapshot=await loadMarketingSnapshot();expect(snapshot.inventoryReadback).toMatchObject({status:"error",lastSuccessfulReadAt:readAt,errorCode:"creative_inventory_unavailable"});expect(snapshot.inventory).toBeUndefined();expect(snapshot.creatives).toEqual([]);expect(snapshot.fetchedAt).toBe(metaAt);expect(snapshot.connectionErrors).toEqual(["creative_inventory_unavailable"]);
});

test.each([{locale:undefined},{locale:"fr"},{width:"1080"},{height:NaN},{width:-1},{height:0.5},{title:{}},{caption:undefined},{revision:"1"},{review:"unknown"},{approvedDigest:42},{surface:[]},{sourceUrl:{}},{holdReason:17},{libraryState:[]}])("malformed creative UI fields never become a fresh available read",async patch=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");await loadMarketingSnapshot();
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,creatives:[{...registry().snapshot.creatives[0],...patch}]}});
 const snapshot=await loadMarketingSnapshot();expect(snapshot.inventoryReadback).toMatchObject({status:"error",lastSuccessfulReadAt:readAt,errorCode:"creative_inventory_unavailable"});expect(snapshot.creatives).toEqual([]);expect(snapshot.inventory).toBeUndefined();expect(snapshot.fetchedAt).toBe(metaAt);
});

test("an unknown size or optional owner text stays visible without inventing valid dimensions",async()=>{
 const asset={...registry().snapshot.creatives[0],width:0,height:0,surface:"Owner specific placement",holdReason:"Awaiting actual dimensions",libraryState:"Owner specific state"};
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,creatives:[asset]}});const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");
 expect((await loadMarketingSnapshot()).creatives[0]).toMatchObject({width:0,height:0,surface:asset.surface,holdReason:asset.holdReason,libraryState:asset.libraryState});
});
test.each([{id:undefined},{id:17},{id:""},{assetId:null},{creativeRevision:"1"},{creativeRevision:0},{creativeDigest:[]},{channel:"email"},{destinationLabel:{}},{state:"invented"},{provider:"invented"},{providerReceiptId:{}},{providerReadAt:"invalid"},{postUrl:[]},{receiptKind:null},{manualReportedAt:"invalid"},{errorCode:12}])("malformed publication fields cannot crash an available calendar",async patch=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");await loadMarketingSnapshot();
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[{...publication(),...patch}]}});
 const snapshot=await loadMarketingSnapshot();expect(snapshot.inventoryReadback).toMatchObject({status:"error",lastSuccessfulReadAt:readAt});expect(snapshot.publications).toEqual([]);expect(snapshot.creatives).toEqual([]);expect(snapshot.fetchedAt).toBe(metaAt);
});
test("publication required fields must be own properties and honest unbound records remain visible",async()=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[publication()]}});expect((await loadMarketingSnapshot()).publications).toEqual([publication()]);
 const unbound={...publication(),assetId:"",creativeDigest:"",errorCode:"ASSET_BINDING_UNAVAILABLE"};mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[unbound]}});expect((await loadMarketingSnapshot()).publications).toEqual([unbound]);
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[Object.create(publication())]}});expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe("error");
});
test.each([{creativeDigest:""},{creativeDigest:"not-a-digest"},{creativeDigest:"A".repeat(64)},{assetId:""},{assetId:"bad/id"},{assetId:" ",creativeDigest:""}])("partial or malformed publication binding is not a successful inventory read",async patch=>{
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[{...publication(),...patch}]}});const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe("error");
});
test("explicit producer missing-binding record preserves its source ID without claiming an exact creative",async()=>{
 const missing={...publication(),creativeDigest:"",errorCode:"ASSET_BINDING_UNAVAILABLE"};mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[missing]}});
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");expect((await loadMarketingSnapshot()).publications).toEqual([missing]);
 for(const patch of [{state:"ready"},{provider:"whapi"},{creativeDigest:"not-a-digest"}]){mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[{...missing,...patch}]}});expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe("error");}
});

test.each([
 {state:"unknown",errorCode:"Historical provider evidence cannot be matched"},
 {state:"skipped",errorCode:null},
 {state:"draft",errorCode:"CALENDAR_BLOCKED"},
 {state:"draft",errorCode:"SCHEDULED_ASSET_BINDING_MISSING",scheduledFor:readAt},
 {state:"held",errorCode:"PUBLISHER_HELD"},
])("honest unbound historical Status records do not hide the valid creative library: %j",async patch=>{
 const unresolved={...publication(),creativeDigest:"",...patch};
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[unresolved]}});
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");
 const snapshot=await loadMarketingSnapshot();expect(snapshot.inventoryReadback?.status).toBe("available");expect(snapshot.creatives).toHaveLength(1);expect(snapshot.publications).toEqual([unresolved]);
});

test.each([{state:"ready"},{state:"scheduled"},{state:"sending"},{state:"published"},{state:"manually_reported"},{provider:"whapi"},{providerReceiptId:"invented"},{providerReadAt:readAt},{manualReportedAt:readAt},{receiptKind:"publication"},{confirmedAt:readAt},{postUrl:"https://www.facebook.com/demo/posts/123"}])("missing image binding cannot acquire actionable or verified delivery evidence: %j",async patch=>{
 const unresolved={...publication(),creativeDigest:"",state:"unknown",errorCode:"UNRESOLVED",...patch};
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[unresolved]}});
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe("error");
});

test.each([readAt,"invalid",17,null])("inherited confirmation evidence is rejected: %j",async confirmedAt=>{
 const inherited=Object.assign(Object.create({confirmedAt}),publication(),{state:"published"});
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[inherited]}});
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");
 expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe("error");
});

test.each(["draft","held","ready","scheduled","sending","published","failed","unknown","skipped","manually_reported"])("unbound %s records cannot carry delivery evidence even with an exact digest",async state=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");
 for(const patch of [{postUrl:"https://www.facebook.com/demo/posts/123"},{providerReceiptId:"DEMO-receipt"},{providerReadAt:readAt},{manualReportedAt:readAt},{confirmedAt:readAt},{receiptKind:"publication"},{receiptKind:"schedule"},{receiptKind:"manual_open"}]){
  mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[{...publication(),state,...patch}]}});
  expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe("error");
 }
});

test("current publisher held and confirmed timestamp fields are validated without upgrading their states",async()=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");
 const held={...publication(),state:"held",provider:"whapi",confirmedAt:null,errorCode:"PUBLISHER_HELD"};
 mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[held]}});expect((await loadMarketingSnapshot()).publications).toEqual([held]);
 for(const confirmedAt of ["invalid",17,{}]){mocks.registry.mockResolvedValue({success:true,snapshot:{...registry().snapshot,publications:[{...held,confirmedAt}]}});expect((await loadMarketingSnapshot()).inventoryReadback?.status).toBe("error");}
});
