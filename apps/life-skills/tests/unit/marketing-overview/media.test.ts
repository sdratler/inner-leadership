import {createHash} from "node:crypto";
import {beforeEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({actor:vi.fn(),read:vi.fn()}));
vi.mock("../../../src/features/identity/runtime.ts",()=>({identityRuntime:async()=>({services:{sessions:{actor:mocks.actor}}})}));
vi.mock("../../../src/features/prospects/bridge.ts",()=>({crmBridgeImage:mocks.read}));
import {marketingMedia} from "../../../src/features/marketing-overview/media.ts";
import {creativeMediaPath} from "../../../src/features/marketing-overview/media-link.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNfkAAAAASUVORK5CYII=','base64'),digest=createHash("sha256").update(bytes).digest("hex");
const url=`https://life-skills.bneineviimacademy.org/api/marketing/assets/DEMO-image?revision=1&digest=${digest}`;
const request=(value=url,cookie=`${SESSION_COOKIE}=ordinary-test-token`)=>new Request(value,{headers:{cookie}});
const image=(data=bytes,headers={})=>new Response(new Uint8Array(data),{headers:{"content-type":"image/png","content-length":String(data.length),...headers}});
beforeEach(()=>{vi.clearAllMocks();mocks.actor.mockResolvedValue({role:"practitioner"});mocks.read.mockImplementation(async()=>image());});
test("ordinary practitioner receives exact private bytes and original download, without provider secrets",async()=>{
 const response=await marketingMedia(request(url+"&download=1"),"DEMO-image");expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
 expect(mocks.actor).toHaveBeenCalledWith("ordinary-test-token");expect(mocks.read).toHaveBeenCalledWith("DEMO-image",1,digest,true);
 expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("content-disposition")).toBe('attachment; filename="DEMO-image-r1.png"');expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
});
test("read-only secondary media keeps the exact collection binding and ordinary authorization",async()=>{
 const response=await marketingMedia(request(url+'&collection=history&download=1'),'DEMO-image');expect(response.status).toBe(200);expect(mocks.read).toHaveBeenCalledWith('DEMO-image',1,digest,true,'history');
 mocks.read.mockClear();for(const suffix of ['&collection=all','&collection=history&collection=templates','&collection=constructor'])expect((await marketingMedia(request(url+suffix),'DEMO-image')).status).toBe(400);expect(mocks.read).not.toHaveBeenCalled();
 mocks.actor.mockResolvedValue({role:'parent'});expect((await marketingMedia(request(url+'&collection=templates'),'DEMO-image')).status).toBe(403);expect(mocks.read).not.toHaveBeenCalled();
 const row={assetId:'DEMO-image',revision:1,contentDigest:digest,imageUrl:'https://drive.google.com/file/d/synthetic_file/view',collection:'history'} as Parameters<typeof creativeMediaPath>[0];const link=creativeMediaPath(row)!;expect(link).toContain('collection=history');expect(creativeMediaPath({...row,imageUrl:link},true)).toContain('collection=history&download=1');
});
test.each(["parent","child","adult_client"])("%s cannot read the private gallery media or reach a provider",async role=>{
 mocks.actor.mockResolvedValue({role});const response=await marketingMedia(request(),"DEMO-image");expect(response.status).toBe(403);expect(mocks.read).not.toHaveBeenCalled();
});
test("absent/duplicate ordinary sessions and spoofed role query do not grant media access",async()=>{
 for(const cookie of ["",`${SESSION_COOKIE}=one; ${SESSION_COOKIE}=two`])expect((await marketingMedia(request(url,cookie),"DEMO-image")).status).toBe(401);
 expect(mocks.read).not.toHaveBeenCalled();expect((await marketingMedia(request(url+"&role=practitioner"),"DEMO-image")).status).toBe(400);
});
test("malformed/ambiguous selectors fail before provider reads; stale source remains a conflict",async()=>{
 for(const value of [url+"&revision=1",url+"&download=0",url.replace("revision=1","revision=0"),url.replace(digest,"bad")])expect((await marketingMedia(request(value),"DEMO-image")).status).toBe(400);
 expect((await marketingMedia(request(),`bad"; filename="injected`)).status).toBe(400);expect(mocks.read).not.toHaveBeenCalled();
 mocks.read.mockResolvedValue(new Response(null,{status:409}));expect((await marketingMedia(request(),"DEMO-image")).status).toBe(409);
});
test("non-image, partial and altered upstream bytes fail closed; errors reveal no upstream detail",async()=>{
 mocks.read.mockResolvedValue(image(bytes,{"content-type":"text/html"}));expect((await marketingMedia(request(),"DEMO-image")).status).toBe(503);
 mocks.read.mockResolvedValue(image(bytes,{"content-length":String(bytes.length+1)}));expect((await marketingMedia(request(),"DEMO-image")).status).toBe(409);
 mocks.read.mockResolvedValue(image(Buffer.from(bytes.map((value,index)=>index===40?value^1:value))));expect((await marketingMedia(request(),"DEMO-image")).status).toBe(409);
 mocks.read.mockRejectedValue(Error("PRIVATE_PROVIDER_DETAIL"));const response=await marketingMedia(request(),"DEMO-image");expect(response.status).toBe(503);expect(await response.text()).not.toContain("PRIVATE_PROVIDER_DETAIL");
});
test("image links name only the registered version and digest; invalid/missing originals have no link",()=>{
 const asset={assetId:"DEMO-image",revision:1,contentDigest:digest,imageUrl:"https://drive.google.com/file/d/synthetic_file/view"} as Parameters<typeof creativeMediaPath>[0];
 expect(creativeMediaPath(asset)).toBe(url.replace("https://life-skills.bneineviimacademy.org",""));expect(creativeMediaPath(asset,true)).toContain("download=1");expect(creativeMediaPath({...asset,imageUrl:null})).toBeNull();expect(creativeMediaPath({...asset,assetId:"../bad"})).toBeNull();
 expect(creativeMediaPath({...asset,registeredRevision:false})).toBeNull();expect(creativeMediaPath({...asset,registeredRevision:true})).toBe(url.replace("https://life-skills.bneineviimacademy.org",""));
 for(const imageUrl of ["https://attacker.invalid/file/d/synthetic_file/view","https://drive.google.com.evil.invalid/file/d/synthetic_file/view","/api/marketing/assets/other?revision=1","https://drive.google.com/drive/folders/synthetic_file"])expect(creativeMediaPath({...asset,imageUrl})).toBeNull();
});
