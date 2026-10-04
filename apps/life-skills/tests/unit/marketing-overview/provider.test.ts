import {beforeEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({registry:vi.fn(),meta:vi.fn()}));
vi.mock("../../../src/features/prospects/bridge.ts",()=>({crmBridge:mocks.registry}));
vi.mock("../../../src/features/marketing-overview/meta-provider.ts",()=>({readDirectMetaAds:mocks.meta}));
const readAt="2026-10-03T18:05:49.000Z",metaAt="2026-10-03T19:00:00.000Z";
const registry=()=>({success:true,snapshot:{fetchedAt:readAt,workbookUrl:"https://docs.google.com/spreadsheets/d/synthetic/edit",creatives:[{assetId:"DEMO-image",revision:1,imageUrl:"https://drive.google.com/file/d/synthetic_file/view",sourceUrl:"https://drive.google.com/file/d/synthetic_file/view",contentDigest:"a".repeat(64),locale:"he",width:1080,height:1920,review:"in_review",approvedDigest:null,caption:"",title:"Synthetic original"}],publications:[],inventory:{}}});
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
test.each([{success:false},{success:true,snapshot:{}},{success:true,snapshot:{...registry().snapshot,fetchedAt:"invalid"}},{success:true,snapshot:{...registry().snapshot,fetchedAt:null}},{success:true,snapshot:{...registry().snapshot,creatives:[null]}},{success:true,snapshot:{...registry().snapshot,creatives:Array(1001).fill(registry().snapshot.creatives[0])}}])("malformed inventory is unavailable without losing independent Meta data",async payload=>{
 const {loadMarketingSnapshot}=await import("../../../src/features/marketing-overview/provider.ts");await loadMarketingSnapshot();mocks.registry.mockResolvedValue(payload);
 const snapshot=await loadMarketingSnapshot();expect(snapshot.inventoryReadback).toMatchObject({status:"error",lastSuccessfulReadAt:readAt});expect(snapshot.creatives).toEqual([]);expect(snapshot.fetchedAt).toBe(metaAt);expect(snapshot.connectionErrors).toEqual(["creative_inventory_unavailable"]);
});
