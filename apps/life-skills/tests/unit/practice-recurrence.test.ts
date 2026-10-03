import {afterEach,expect,test,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {recurrenceInput,recurrenceCommand,recurrencePlan,type RecurrencePlan} from "../../src/features/home-practice/recurrence-input.ts";
import {readRecurrence,saveRecurrence,recurrenceReadback} from "../../src/features/home-practice/management-client.ts";
import {RecurrenceControls} from "../../src/features/home-practice/recurrence-controls.tsx";
import type {ManagedPracticeVersion} from "../../src/features/home-practice/types.ts";
import {asId} from "../../src/lib/ids.ts";
import {readFileSync} from "node:fs";
test('the containing workspace owns one guard for recurrence drafts and authoring input',()=>{
 const control=readFileSync(new URL('../../src/features/home-practice/recurrence-controls.tsx',import.meta.url),'utf8'),workspace=readFileSync(new URL('../../src/features/home-practice/management-workspace.tsx',import.meta.url),'utf8');
 expect(control).not.toContain('UnsavedChangesGuard');expect(control).toContain('stateRef.current({dirty,locked})');
 expect(workspace).toContain('dirty=draftDirty||rangeDirty');expect(workspace.match(/<UnsavedChangesGuard/g)).toHaveLength(1);
});
const ids=Array.from({length:7},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`),digest="a".repeat(64);
const input={assignmentId:ids[0]!,expectedVersionId:ids[1]!,expectedSnapshotDigest:digest,from:"2026-10-02",to:"2026-10-03"};
const plan:RecurrencePlan={assignmentId:ids[0]!,practiceVersionId:ids[1]!,caseId:ids[2]!,audienceId:ids[3]!,from:input.from,to:input.to,localTime:"18:45",timezone:"UTC",weekdays:[5,6],planDigest:"b".repeat(64),items:[2,3].map((day,index)=>({id:ids[4+index]!,assignmentId:ids[0]!,practiceVersionId:ids[1]!,coordinationVersionId:ids[6]!,occursOn:`2026-10-0${day}`,period:"morning",occursAt:`2026-10-0${day}T18:45:00.000Z`,state:"open",existing:false}))};
const reply=(data:unknown)=>new Response(JSON.stringify({ok:true,data}));
afterEach(()=>vi.unstubAllGlobals());
test("inclusive 42 real dates, exact digests and strict keys are mandatory",()=>{
 expect(recurrenceInput.safeParse({...input,to:"2026-11-12"}).success).toBe(true);
 for(const fields of [{...input,to:"2026-11-13"},{...input,to:"2026-10-01"},{...input,from:"2026-02-30"},{...input,expectedSnapshotDigest:""},{...input,accountId:ids[6]},{...input,timezone:"UTC"}])expect(recurrenceInput.safeParse(fields).success).toBe(false);
 expect(recurrenceCommand.safeParse({...input,expectedPlanDigest:plan.planDigest}).success).toBe(true);expect(recurrenceCommand.safeParse({...input,expectedPlanDigest:"unknown"}).success).toBe(false);
});
test("a returned plan cannot invent a clock, duplicate a date or add a clinical field",()=>{
 expect(recurrencePlan.safeParse(plan).success).toBe(true);
 for(const data of [{...plan,localTime:"25:90"},{...plan,timezone:"invented/not-a-zone"},{...plan,weekdays:[5,5]},{...plan,items:plan.items.slice(0,1)},{...plan,items:[plan.items[0],plan.items[0]]},{...plan,items:[...plan.items].reverse()},{...plan,items:[{...plan.items[0],occursOn:"2026-10-01"}]},{...plan,items:[{...plan.items[0],practiceVersionId:ids[6]}]},{...plan,privateNote:"must not project"}])expect(recurrencePlan.safeParse(data).success).toBe(false);
});
test("exact context protected GET never substitutes a foreign or partial plan",async()=>{
 const fetcher=vi.fn().mockResolvedValue(reply(plan));vi.stubGlobal("fetch",fetcher);expect(await readRecurrence(input,plan.caseId,plan.audienceId)).toEqual(plan);
 expect(fetcher.mock.calls[0]?.[0]).toBe("/api/home-practice?"+new URLSearchParams({view:"recurrence",...input}));expect(fetcher.mock.calls[0]?.[1]).toMatchObject({credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
 for(const data of [{...plan,caseId:ids[6]},{...plan,audienceId:ids[6]},{...plan,from:"2026-10-01"},{...plan,items:[{...plan.items[0],assignmentId:ids[6]}]}]){fetcher.mockResolvedValueOnce(reply(data));await expect(readRecurrence(input,plan.caseId,plan.audienceId)).rejects.toMatchObject({code:"UNAVAILABLE"});}
 fetcher.mockRejectedValueOnce(new Error("synthetic transport"));await expect(readRecurrence(input,plan.caseId,plan.audienceId)).rejects.toMatchObject({code:"UNAVAILABLE"});
});
test("normal practitioner session and CSRF protect the confirmed range command",async()=>{
 const saved={...plan,items:plan.items.map(row=>({...row,existing:true}))},fetcher=vi.fn().mockResolvedValueOnce(reply({role:"practitioner",csrfToken:"synthetic-csrf"})).mockResolvedValueOnce(reply(saved));vi.stubGlobal("fetch",fetcher);
 const command={...input,expectedPlanDigest:plan.planDigest};expect(await saveRecurrence(command,plan.caseId,plan.audienceId)).toEqual(saved);
 expect(fetcher.mock.calls[1]?.[1]).toMatchObject({method:"POST",headers:{"X-CSRF-Token":"synthetic-csrf"},body:JSON.stringify({action:"schedule_range",...command})});
 fetcher.mockResolvedValueOnce(reply({role:"parent",csrfToken:"synthetic-csrf"}));await expect(saveRecurrence(command,plan.caseId,plan.audienceId)).rejects.toMatchObject({code:"NOT_FOUND"});expect(fetcher).toHaveBeenCalledTimes(3);
});
test("201 is not save proof: all original rows and their frozen coordination need GET readback",()=>{
 const saved={...plan,items:plan.items.map(row=>({...row,existing:true}))};expect(recurrenceReadback(plan,saved)).toBe(true);
 for(const current of [plan,{...saved,planDigest:digest},{...saved,items:saved.items.slice(0,1)},{...saved,items:[{...saved.items[0]!,coordinationVersionId:ids[0]!},saved.items[1]!]},{...saved,items:[{...saved.items[0]!,occursAt:"2026-10-02T19:00:00.000Z"},saved.items[1]!]}])expect(recurrenceReadback(plan,current)).toBe(false);
 expect(recurrenceReadback(plan,{...saved,items:saved.items.map(row=>({...row,state:"closed"}))})).toBe(true);
});
test.each(["en","he"]as const)("%s recurring controls start collapsed, blank and fail closed without a digest",locale=>{
 const row:ManagedPracticeVersion={workspaceId:asId(ids[6]!,"workspace"),caseId:asId(plan.caseId,"case"),audienceId:asId(plan.audienceId,"audience"),assignmentId:asId(input.assignmentId,"practice_assignment"),versionId:asId(input.expectedVersionId,"practice_version"),version:1,state:"published",active:true,goalId:null,commitmentId:null,templateKey:"Synthetic",templateVersion:"synthetic-v1",instructions:"Synthetic instructions",startsOn:input.from,endsOn:input.to,publishedAt:"2026-10-01T12:00:00.000Z",immutableSnapshotDigest:digest};
 const html=renderToStaticMarkup(createElement(RecurrenceControls,{locale,row,disabled:false,onState:()=>{}}));expect(html).toMatch(/^<details class="lsw-details">/);expect(html.match(/value=""/g)).toHaveLength(2);expect(html).not.toContain("Saved and verified");expect(html).not.toContain("Confirm recurring schedule");expect(html).toContain(locale==="he"?"לא נשלחת הודעה":"No message is sent");
 const missing=renderToStaticMarkup(createElement(RecurrenceControls,{locale,row:{...row,immutableSnapshotDigest:null},disabled:false,onState:()=>{}}));expect(missing).toContain('type="submit" disabled=""');
});
