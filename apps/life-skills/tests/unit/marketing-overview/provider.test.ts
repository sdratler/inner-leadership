import {beforeEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({registry:vi.fn(),meta:vi.fn()}));
vi.mock("../../../src/features/prospects/bridge.ts",()=>({crmBridge:mocks.registry}));
vi.mock("../../../src/features/marketing-overview/meta-provider.ts",()=>({readDirectMetaAds:mocks.meta}));
const readAt="2026-10-03T18:05:49.000Z",metaAt="2026-10-03T19:00:00.000Z";
const inventory=()=>({files:1,concepts:1,publishablePosts:0,heStatusReady:0,heFeedReady:0,enFeedReady:0,adEligible:0,inLiveAds:null,queued:0,published:0,needsApproval:1,needsResizeOrCaption:1,heldMissing:0,partial:true,asOf:readAt});
const registry=()=>({success:true,snapshot:{fetchedAt:readAt,workbookUrl:"https://docs.google.com/spreadsheets/d/synthetic/edit",creatives:[{assetId:"DEMO-image",revision:1,imageUrl:"https://drive.google.com/file/d/synthetic_file/view",sourceUrl:"https://drive.google.com/file/d/synthetic_file/view",contentDigest:"a".repeat(64),locale:"he",width:1080,height:1920,review:"in_review",approvedDigest:null,caption:"",title:"Synthetic original"}],publications:[],inventory:inventory()}});
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();mocks.registry.mockResolvedValue(registry());mocks.meta.mockResolvedValue({fetchedAt:metaAt,ads:[],adSeries:[],adReporting:{}});});
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
