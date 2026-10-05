import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readCommunityInbox } from "../../../src/features/community-inbox/bridge.ts";

const secret = "S".repeat(43);
const page = { items: [{ id: 7, groupName: "Synthetic group", groupUrl: "https://www.facebook.com/groups/synthetic/", postUrl: "https://www.facebook.com/groups/synthetic/posts/7", postedAt: null, capturedAt: "2026-09-25T00:00:00.000Z", excerpt: "Synthetic question", excerptTruncated: false, status: "ready", draft: "Synthetic suggestion", reviewStatus: "pass", revision: 1, copiedAt: null, manuallyPostedAt: null, commentsCaptured: false }], nextCursor: null, commentsCaptureAvailable: false };

describe("Community Scout read-only inbox bridge", () => {
  const aid={englishReadingAid:['A parent asks about a shared daily routine.'],englishReadingAidSourceHash:'a'.repeat(64),englishReadingAidGeneratedAt:'2026-10-05T09:00:00.000Z',englishReadingAidMethod:'existing_analysis'};
  const readAid=(fields:Record<string,unknown>)=>{
    const data={...page,items:[{...page.items[0],...fields}]};
    const fetcher=vi.fn().mockResolvedValue(Response.json({ok:true,data}));
    return {fetcher,data,result:readCommunityInbox('ready','',fetcher,{LS_COMMUNITY_SCOUT_BRIDGE_SECRET:secret})};
  };
  it('accepts bounded source-bound aid and explicit unavailable state without any generation request',async()=>{
    for(const fields of [aid,{englishReadingAid:[],englishReadingAidSourceHash:null,englishReadingAidGeneratedAt:null,englishReadingAidMethod:null}]){
      const r=readAid(fields);await expect(r.result).resolves.toEqual(r.data);expect(r.fetcher).toHaveBeenCalledTimes(1);expect(r.fetcher.mock.calls[0]![1].method).toBe('GET');
    }
  });
  it.each([{englishReadingAidSourceHash:null},{englishReadingAidSourceHash:'invalid'},
    {englishReadingAidGeneratedAt:'yesterday'},{englishReadingAidMethod:'invented'},
    {englishReadingAid:['']},{englishReadingAid:[1]},{englishReadingAid:['x'.repeat(221)]},
    {englishReadingAid:['one','two','three','four']},{englishReadingAid:[]}])('rejects incomplete, inconsistent or unbounded reading aid %j',async patch=>{
    await expect(readAid({...aid,...patch}).result).rejects.toMatchObject({code:'UNAVAILABLE'});
  });
  it('rejects partially upgraded DTO instead of showing unbound summary text',async()=>{
    await expect(readAid({englishReadingAid:['Unbound summary']}).result).rejects.toMatchObject({code:'UNAVAILABLE'});
  });
  it("uses only the registered Scout origin and returns bounded data", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, data: page }));
    await expect(readCommunityInbox("ready", "", fetcher, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).resolves.toEqual(page);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://community-scout-production.up.railway.app/internal/life-skills/posts?status=ready");
    expect(options.headers.Authorization).toBe(`Bearer ${secret}`);
    expect(options.method).toBe("GET");
  });
  it("rejects malformed cursor, missing bridge configuration and invented comment availability", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, data: { ...page, commentsCaptureAvailable: true } }));
    await expect(readCommunityInbox("ready", "bad/cursor", fetcher, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(readCommunityInbox("ready", "", fetcher, {})).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(readCommunityInbox("ready", "", fetcher, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
