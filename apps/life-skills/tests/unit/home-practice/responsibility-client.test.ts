import {afterEach,expect,test,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readResponsibilityParticipants} from "../../../src/features/home-practice/responsibility-client.ts";
import {blankResponsibility,ResponsibilityEditor} from "../../../src/features/home-practice/responsibility-editor.tsx";
const parent="00000000-0000-4000-8000-000000000001",child="00000000-0000-4000-8000-000000000002";
const actual={caseKind:"minor" as const,accounts:[{accountId:parent,role:"parent" as const}]};
afterEach(()=>vi.unstubAllGlobals());
test("participant read uses the existing exact private route and rejects synthetic/foreign-role envelopes",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:true,data:actual})));vi.stubGlobal("fetch",fetcher);
 expect(await readResponsibilityParticipants(parent,child,new AbortController().signal)).toEqual(actual);
 expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/home-practice?view=participants&caseId=${parent}&audienceId=${child}`);
 expect(fetcher.mock.calls[0]?.[1]).toMatchObject({credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
 for(const data of [{...actual,accounts:[...actual.accounts,...actual.accounts]},{...actual,accounts:[{accountId:parent,role:"practitioner"}]},{...actual,accounts:[{accountId:parent,role:"adult_client"}]},{...actual,extra:"invented"}]){
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ok:true,data})));await expect(readResponsibilityParticipants(parent,child,new AbortController().signal)).rejects.toMatchObject({code:"UNAVAILABLE"});
 }
});
test("fresh participant denial or transport failure is not replaced by a fabricated child dropdown",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:false,error:{code:"NOT_FOUND"}}),{status:404}));vi.stubGlobal("fetch",fetcher);
 await expect(readResponsibilityParticipants(parent,child,new AbortController().signal)).rejects.toMatchObject({code:"NOT_FOUND"});
 fetcher.mockRejectedValueOnce(new Error("synthetic transport"));await expect(readResponsibilityParticipants(parent,child,new AbortController().signal)).rejects.toMatchObject({code:"UNAVAILABLE"});
});
test.each(["en","he"]as const)("%s responsibility editor has no invented clock and optional child access is explicit",locale=>{
 const value=blankResponsibility();expect(value.localTime).toBe("");expect(value.timezone).toBe("");expect(value.weekdays).toEqual([]);
 const html=renderToStaticMarkup(createElement(ResponsibilityEditor,{locale,value,participants:actual,locked:false,onChange:()=>{}}));
 expect(html).toContain('type="time" required="" value=""');expect(html).toContain(locale==="he"?"בלי מכשיר של הילד":"without a child device");
 expect(html).not.toContain(child);expect(html).not.toContain('value="08:00"');expect(html).not.toContain('value="20:00"');
 expect(html).toContain(locale==="he"?"לא הרשאת דיווח":"not reporting permission");
 const locked=renderToStaticMarkup(createElement(ResponsibilityEditor,{locale,value:{...value,localTime:"18:45",timezone:"UTC"},participants:actual,locked:true,onChange:()=>{}}));expect(locked).toContain('disabled=""');expect(locked).toContain('value="18:45"');
});
