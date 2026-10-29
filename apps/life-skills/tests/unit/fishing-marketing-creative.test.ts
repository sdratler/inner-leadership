import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {verifiedFishingCreative} from "../../src/features/fishing-marketing/creative.ts";
it("exposes the existing registered creative only when exact bytes and dimensions match",async()=>{
 const result=await verifiedFishingCreative();expect(result).toMatchObject({path:"/groups/academy/prereg-approved-square-20261023.png",width:1254,height:1254});
 expect(await verifiedFishingCreative(async()=>Buffer.alloc(24))).toBeNull();
 expect(await verifiedFishingCreative(async()=>{throw Error("missing");})).toBeNull();
});
