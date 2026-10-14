import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {educationLessonVersionSchema,proposedParentLessonProjection} from "../../../src/features/resources/fishing-content-version-contract.ts";
import {proposedOwnerCatalogProjection} from "../../../src/features/resources/fishing-content-binding.ts";

type Server=Parameters<typeof proposedOwnerCatalogProjection>[1];
type Binding=NonNullable<Awaited<ReturnType<Server["resolveStoredArtifact"]>>>;
const id="00000000-0000-4000-8000-000000000001";
const artifact=(audience:"learner_content"|"teacher_only"|"parent_safe_summary",hex:string)=>({sourceId:"synthetic-"+audience,version:"v1",sha256:hex.repeat(64),locale:"he",status:"approved",audience});
const lesson=educationLessonVersionSchema.parse({lessonKey:"synthetic-lesson",version:"v1",program:"sunday_fishing_academy",rank:"A",learner:artifact("learner_content","a"),teacherGuide:artifact("teacher_only","b"),parentSummary:artifact("parent_safe_summary","c"),sourceRefs:["synthetic-source"]});
function backend():Server{
 return {canonicalWorkspaceId:id,workspaceOwnerAccountId:id,readFreshActor:async()=>({id,workspaceId:id,role:"practitioner",state:"active",sessionRevoked:false}),resolveStoredLesson:async()=>({workspaceId:id,manifest:lesson}),resolveStoredArtifact:async ref=>{
  const source=[lesson.learner,lesson.teacherGuide,lesson.parentSummary].find(x=>x?.sourceId===ref.sourceId);if(!source)return null;
  const binding:Binding={...source,workspaceId:id,storageClass:source.audience==="teacher_only"?"protected_teacher":source.audience==="learner_content"?"resource_learner":"resource_parent_summary"};return binding;
 }};
}
describe("initial owner-private immutable fishing catalog boundary",()=>{
 it("returns only an owner DTO after trusted manifest and artifact readback",async()=>{
  const result=await proposedOwnerCatalogProjection(lesson,backend());expect(result.teacherGuide?.sourceId).toBe(lesson.teacherGuide.sourceId);expect(result).not.toHaveProperty("sourceRefs");
 });
 it.each(["parent","child","adult_client","instructor","marketing","student"])("denies %s before reading catalog sources",async role=>{
  const server=backend();server.readFreshActor=async()=>({id,workspaceId:id,role,state:"active",sessionRevoked:false});const read=vi.spyOn(server,"resolveStoredLesson");
  await expect(proposedOwnerCatalogProjection(lesson,server)).rejects.toThrow("FORBIDDEN");expect(read).not.toHaveBeenCalled();expect(proposedParentLessonProjection()).toBeNull();
 });
 it.each(["disabled","revoked","different_owner","different_workspace"])("denies %s identity",async denial=>{
  const server=backend();server.readFreshActor=async()=>({id:denial==="different_owner"?id+"x":id,workspaceId:denial==="different_workspace"?id+"x":id,role:"practitioner",state:denial==="disabled"?"disabled":"active",sessionRevoked:denial==="revoked"});
  await expect(proposedOwnerCatalogProjection(lesson,server)).rejects.toThrow("FORBIDDEN");
 });
 it.each([{lessonKey:"other-lesson"},{version:"v2"},{rank:"B"},{sourceRefs:["other-source"]},{learner:{...lesson.learner,sourceId:"other-approved-learner",sha256:"d".repeat(64)}}])("denies relabeled/mixed manifest %j",async change=>{
  await expect(proposedOwnerCatalogProjection({...lesson,...change},backend())).rejects.toThrow("MANIFEST_BINDING_DENIED");
 });
 it.each(["missing","wrong_workspace"])("denies %s trusted manifest",async denial=>{
  const server=backend();server.resolveStoredLesson=async()=>denial==="missing"?null:{workspaceId:id+"x",manifest:lesson};await expect(proposedOwnerCatalogProjection(lesson,server)).rejects.toThrow("MANIFEST_BINDING_DENIED");
 });
 it.each(["teacher_alias","teacher_bytes"])("rejects %s in learner and parent summary",denial=>{
  for(const field of ["learner","parentSummary"] as const){const value=lesson[field]!;const corrupt={...value,...(denial==="teacher_alias"?{sourceId:lesson.teacherGuide.sourceId}:{sha256:lesson.teacherGuide.sha256})};expect(educationLessonVersionSchema.safeParse({...lesson,[field]:corrupt}).success).toBe(false);}
 });
 it.each(["protected_teacher","wrong_workspace","withdrawn","wrong_hash"])("denies source binding %s",async denial=>{
  const server=backend(),original=server.resolveStoredArtifact;server.resolveStoredArtifact=async ref=>{const binding=await original(ref);return binding?{...binding,...(denial==="protected_teacher"?{storageClass:"protected_teacher" as const}:denial==="wrong_workspace"?{workspaceId:id+"x"}:denial==="withdrawn"?{status:"withdrawn" as const}:{sha256:"d".repeat(64)})}:null;};
  await expect(proposedOwnerCatalogProjection(lesson,server)).rejects.toThrow("STORAGE_BINDING_DENIED");
 });
});
