import {expect,it} from "vitest";
import {fishingRecordState,marketingFilters} from "../../src/features/fishing-marketing/filters.ts";
it("keeps uncertain and manually reported outcomes out of verified publications",()=>{
 expect(fishingRecordState({state:"published_browser_readback_verified",publicationEvidence:"browser_readback"})).toBe("published");
 expect(fishingRecordState({state:"published_verified",publicationEvidence:"unverified"})).toBe("problem");
 expect(fishingRecordState({state:"manually_reported",publicationEvidence:"unverified"})).toBe("problem");
 expect(fishingRecordState({state:"pending_admin_approval",publicationEvidence:"unverified"})).toBe("pending");
 expect(fishingRecordState({state:"ready",publicationEvidence:"unverified"})).toBe("draft");
});
it("normalizes unknown filters without selecting another program or channel",()=>{
 expect(marketingFilters({program:"unexpected",channel:["page"],state:"nope"})).toEqual({program:"all",channel:"all",state:"all"});
 expect(marketingFilters({program:"bna",channel:"groups",state:"problem"})).toEqual({program:"bna",channel:"groups",state:"problem"});
});
