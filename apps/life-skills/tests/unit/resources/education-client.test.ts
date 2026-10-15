import {afterEach,expect,test,vi} from "vitest";
import {LessonClientError,pendingLessonOperation,readEducationLesson,saveEducationLesson} from "../../../src/features/resources/education-client.ts";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,reference={learnerId:id(3),moduleId:"RM-101",version:"synthetic-v1"};
const command={action:"submit"as const,operationId:id(4),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"Synthetic draft"}]};
const response=(data:unknown)=>Response.json({ok:true,data,requestId:id(8)});
const session=(role="parent")=>response({accountId:id(1),role,locale:"en",expiresAt:"2026-10-16T00:00:00Z",csrfToken:"synthetic-csrf"});
afterEach(()=>vi.unstubAllGlobals());
test("lost response preserves immutable exact request bytes/key; retry uses the fresh ordinary session",async()=>{
 const operation=pendingLessonOperation(reference,command),bodies:string[]=[],fetcher=vi.fn(async(path:unknown,init?:RequestInit)=>{
  if(path==="/api/identity/session")return session();bodies.push(String(init?.body));if(bodies.length===1)throw Error("synthetic lost response");
  return response({revisionId:id(9),duplicate:true});
 });vi.stubGlobal("fetch",fetcher);
 await expect(saveEducationLesson(operation,"parent")).rejects.toMatchObject({code:"UNAVAILABLE",uncertain:true});
 command.answers[0]!.value="Changed draft after uncertain operation";
 expect(await saveEducationLesson(operation,"parent")).toEqual({revisionId:id(9),duplicate:true});
 expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);expect(bodies[0]).toContain("Synthetic draft");command.answers[0]!.value="Synthetic draft";
 expect(fetcher).toHaveBeenCalledWith("/api/resources/education/lesson",expect.objectContaining({credentials:"same-origin",redirect:"error",headers:expect.objectContaining({"x-csrf-token":"synthetic-csrf"})}));
});
test("confirmed conflict is not successful or automatically retried",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(path:unknown)=>path==="/api/identity/session"?session():Response.json({ok:false,error:{code:"CONFLICT"}},{status:409})));
 await expect(saveEducationLesson(pendingLessonOperation(reference,command),"parent")).rejects.toMatchObject({code:"CONFLICT",uncertain:false});
});
test("ordinary account role mismatch or sign-out cannot make a write",async()=>{
 const fetcher=vi.fn(async()=>session("practitioner"));vi.stubGlobal("fetch",fetcher);
 await expect(saveEducationLesson(pendingLessonOperation(reference,command),"parent")).rejects.toMatchObject({code:"FORBIDDEN",uncertain:false});expect(fetcher).toHaveBeenCalledTimes(1);
 fetcher.mockImplementation(async()=>Response.json({ok:false,error:{code:"UNAUTHENTICATED"}},{status:401}));
 await expect(readEducationLesson(reference,"learner","parent")).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
test("parent read accepts only the closed published summary; teacher/private directory fields fail closed",async()=>{
 let data:unknown={moduleId:reference.moduleId,version:reference.version,portfolio:null};
 vi.stubGlobal("fetch",vi.fn(async(path:unknown)=>path==="/api/identity/session"?session():response(data)));
 expect(await readEducationLesson(reference,"parent","parent")).toEqual(data);
 data={moduleId:reference.moduleId,version:reference.version,portfolio:null,summaryRecipients:[{accountId:id(1),label:"private@example.invalid"}]};
 await expect(readEducationLesson(reference,"parent","parent")).rejects.toBeInstanceOf(LessonClientError);
});
test("readback from a different version is not rendered as the selected context",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(path:unknown)=>path==="/api/identity/session"?session():response({moduleId:"RM-102",version:reference.version,portfolio:null})));
 await expect(readEducationLesson(reference,"parent","parent")).rejects.toMatchObject({code:"UNAVAILABLE",uncertain:false});
});
test("long Unicode request remains bounded before any real fetch or operation change",()=>{
 expect(()=>pendingLessonOperation(reference,{...command,answers:Array.from({length:3},(_,i)=>({questionId:`Q01-${i+1}`,value:"界".repeat(2000)}))})).toThrow("PAYLOAD_TOO_LARGE");
 expect(command.operationId).toBe(id(4));
});
test("malformed successful save and server failure retain an uncertain operation",async()=>{
 let r=Response.json({ok:true,data:{success:true},requestId:id(8)});vi.stubGlobal("fetch",vi.fn(async(path:unknown)=>path==="/api/identity/session"?session():r));
 await expect(saveEducationLesson(pendingLessonOperation(reference,command),"parent")).rejects.toMatchObject({code:"UNAVAILABLE",uncertain:true});
 r=Response.json({ok:false,error:{code:"UNAVAILABLE"}},{status:503});
 await expect(saveEducationLesson(pendingLessonOperation(reference,command),"parent")).rejects.toMatchObject({code:"UNAVAILABLE",uncertain:true});
});
