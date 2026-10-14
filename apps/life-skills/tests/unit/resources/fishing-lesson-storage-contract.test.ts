import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {asId} from "../../../src/lib/ids.ts";
import {seal,type Keyring} from "../../../src/features/identity/crypto.ts";
import {decodeLessonEvent,educationArtifactAad,educationStorageBindingSchema,encodeLessonEvent,readOwnerVersionedLesson,
 type EducationStorageBinding,type OwnerLessonStorage} from "../../../src/features/resources/fishing-lesson-storage-contract.ts";
import {learnerLessonSchema,lessonJourneyCommandSchema,type LessonJourneyEvent} from "../../../src/features/resources/fishing-lesson-journey.ts";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const keys:Keyring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,7)}};
const now=new Date("2026-10-14T16:00:00Z"),digest=(text:string)=>createHash("sha256").update(text).digest("hex");
function fixture(state:"prepared"|"approved"="prepared"){
 const learner=learnerLessonSchema.parse({moduleId:"RM-101",version:"synthetic-v1",stage:1,locale:"en",title:"Synthetic lesson",
  instruction:"Synthetic hookless instruction",questions:[{id:"Q01-1",prompt:"Synthetic question"}],sourceSha256:"a".repeat(64),status:state});
 const learnerBytes=JSON.stringify(learner),teacherBytes="SYNTHETIC PRIVATE INSTRUCTOR ANSWER";
 const catalog:EducationStorageBinding={workspaceId:id(1),moduleId:"RM-101",version:learner.version,state,
  source:{sourceId:"synthetic-review-source",revision:"synthetic-revision",sha256:"a".repeat(64)},
  learner:{sourceId:"synthetic-learner",version:"v1",locale:"en",sha256:digest(learnerBytes),storageClass:"resource_learner",state},
  teacher:{sourceId:"synthetic-teacher",version:"v1",locale:"en",sha256:digest(teacherBytes),storageClass:"protected_teacher",state}};
 const actor={id:asId(id(2),"account"),workspaceId:asId(id(1),"workspace"),personId:asId(id(3),"person"),role:"practitioner" as const,
  state:"active" as const,locale:"en" as const,sessionDigest:"synthetic",expiresAt:now.getTime()+60000};
 const server:OwnerLessonStorage={canonicalWorkspaceId:id(1),ownerAccountId:id(2),readFreshActor:async()=>({actor,sessionRevoked:false}),
  resolveCatalog:async()=>structuredClone(catalog),resolveArtifact:async ref=>{
   const binding=ref.sourceId===catalog.learner.sourceId?catalog.learner:catalog.teacher;
   return {workspaceId:id(1),reference:structuredClone(binding),ciphertext:seal(binding.storageClass==="resource_learner"?learnerBytes:teacherBytes,
    educationArtifactAad(id(1),binding),keys)};
  }};
 return {server,catalog,learner,teacherBytes,actor};
}
const reference={moduleId:"RM-101",version:"synthetic-v1"};
function event():LessonJourneyEvent{
 const command=lessonJourneyCommandSchema.parse({action:"observe",operationId:id(7),expectedRevisionId:id(4),submissionId:id(4),
  task:"Synthetic practice",assistance:"with_guidance",privateNote:"SYNTHETIC PRIVATE OBSERVATION"});
 const record={id:id(5),operationId:id(7),digest:"",previousRevisionId:id(4),workspaceId:id(1),learnerId:id(3),moduleId:"RM-101",version:"synthetic-v1",
  sourceSha256:"a".repeat(64),actorId:id(2),actorRole:"practitioner" as const,at:now.toISOString(),command};
 record.digest=digest(JSON.stringify({ref:{learnerId:record.learnerId,moduleId:record.moduleId,version:record.version},command,
  actorId:record.actorId,workspaceId:record.workspaceId,sourceSha256:record.sourceSha256}));return record;
}
describe("prepared owner-private exact content and encrypted event boundary",()=>{
 it("reads a truthful Draft learner projection after exact private source/byte validation, never teacher bytes",async()=>{
  const {server,learner}=fixture();
  const value=await readOwnerVersionedLesson(reference,server,keys,now);
  expect(value).toEqual({catalogState:"prepared",source:{sourceId:"synthetic-review-source",revision:"synthetic-revision",sha256:"a".repeat(64)},lesson:learner});
  expect(JSON.stringify(value)).not.toMatch(/INSTRUCTOR ANSWER|protected_teacher|ciphertext|teacher/);
 });
 it("accepts isolated synthetic approved bytes without approving an actual catalog",async()=>{
  const {server}=fixture("approved");expect(await readOwnerVersionedLesson(reference,server,keys,now)).toMatchObject({catalogState:"approved"});
 });
 it.each(["parent","child","adult_client","marketing","instructor"])("denies %s before reading the catalog",async role=>{
  const {server,actor}=fixture();server.readFreshActor=async()=>({actor:{...actor,role:role as typeof actor.role},sessionRevoked:false});
  const read=vi.spyOn(server,"resolveCatalog");await expect(readOwnerVersionedLesson(reference,server,keys,now)).rejects.toThrow("FORBIDDEN");expect(read).not.toHaveBeenCalled();
 });
 it.each(["revoked","expired","wrong_owner","wrong_workspace","inactive"])("denies %s owner state before reading artifacts",async denial=>{
  const {server,actor}=fixture();server.readFreshActor=async()=>({actor:{...actor,id:asId(denial==="wrong_owner"?id(99):actor.id,"account"),
   workspaceId:asId(denial==="wrong_workspace"?id(99):actor.workspaceId,"workspace"),expiresAt:denial==="expired"?now.getTime():actor.expiresAt,
   state:denial==="inactive"?"revoked":"active"},sessionRevoked:denial==="revoked"});
  const read=vi.spyOn(server,"resolveArtifact");await expect(readOwnerVersionedLesson(reference,server,keys,now)).rejects.toThrow("FORBIDDEN");expect(read).not.toHaveBeenCalled();
 });
 it.each(["workspace","module","version","withdrawn"])("denies %s catalog drift",async drift=>{
  const {server,catalog}=fixture();server.resolveCatalog=async()=>({...catalog,...(drift==="workspace"?{workspaceId:id(99)}:
   drift==="module"?{moduleId:"RM-102"}:drift==="version"?{version:"v2"}:{state:"withdrawn",learner:{...catalog.learner,state:"withdrawn"},teacher:{...catalog.teacher,state:"withdrawn"}})});
  await expect(readOwnerVersionedLesson(reference,server,keys,now)).rejects.toThrow("BINDING_DENIED");
 });
 it.each(["teacher_alias","teacher_hash","teacher_class","mixed_status"])("rejects %s source tuple before any payload projection",caseName=>{
  const {catalog}=fixture();const value={...catalog,learner:{...catalog.learner,...(caseName==="teacher_alias"?{sourceId:catalog.teacher.sourceId}:
   caseName==="teacher_hash"?{sha256:catalog.teacher.sha256}:caseName==="teacher_class"?{storageClass:"protected_teacher"}:{state:"approved"})}};
  expect(educationStorageBindingSchema.safeParse(value).success).toBe(false);
 });
 it.each(["missing","workspace","classification","version","hash"])("denies %s artifact binding",async drift=>{
  const {server}=fixture(),original=server.resolveArtifact;
  server.resolveArtifact=async ref=>{const found=await original(ref);if(!found)return null;
   return drift==="missing"?null:{...found,...(drift==="workspace"?{workspaceId:id(99)}:{reference:{...(found.reference as object),
    ...(drift==="classification"?{storageClass:"protected_teacher"}:drift==="version"?{version:"v2"}:{sha256:"f".repeat(64)})}})};};
  await expect(readOwnerVersionedLesson(reference,server,keys,now)).rejects.toThrow();
 });
 it("rejects authenticated but wrong plaintext bytes, not just metadata hashes",async()=>{
  const {server,catalog}=fixture();server.resolveArtifact=async ref=>{const binding=ref.sourceId===catalog.learner.sourceId?catalog.learner:catalog.teacher;
   return {workspaceId:id(1),reference:binding,ciphertext:seal("changed synthetic bytes",educationArtifactAad(id(1),binding),keys)};};
  await expect(readOwnerVersionedLesson(reference,server,keys,now)).rejects.toThrow("CONTENT_HASH_MISMATCH");
 });
 it("seals private command bytes and roundtrips after serialized storage reload",()=>{
  const original=event(),sealed=encodeLessonEvent(original,keys),reloaded=JSON.parse(JSON.stringify(sealed));
  expect(sealed.ciphertext).not.toContain("SYNTHETIC PRIVATE OBSERVATION");expect(JSON.stringify(sealed.header)).not.toMatch(/privateNote|Synthetic practice/);
  expect(decodeLessonEvent(reloaded.header,reloaded.ciphertext,keys)).toEqual(original);
  expect(encodeLessonEvent(original,keys).ciphertext).not.toBe(sealed.ciphertext);
 });
 it.each(["workspace","learner","module","version","event","actor","operation","digest","previous","source","role","time"])("denies %s row substitution",field=>{
  const sealed=encodeLessonEvent(event(),keys);const patch={workspace:{workspaceId:id(99)},learner:{learnerId:id(99)},module:{moduleId:"RM-102"},
   version:{version:"v2"},event:{id:id(99)},actor:{actorId:id(99)},operation:{operationId:id(99)},digest:{digest:"f".repeat(64)},
   previous:{previousRevisionId:null},source:{sourceSha256:"f".repeat(64)},role:{actorRole:"parent"},time:{at:"2026-10-14T16:01:00Z"}}[field];
  expect(()=>decodeLessonEvent({...sealed.header,...patch},sealed.ciphertext,keys)).toThrow();
 });
 it("rejects payload, predecessor, operation and unknown-field drift before encryption",()=>{
  const original=event();for(const bad of [{...original,command:{...original.command,privateNote:"changed"}},
   {...original,previousRevisionId:null},{...original,operationId:id(99)},{...original,readiness:true}])
   expect(()=>encodeLessonEvent(bad as LessonJourneyEvent,keys)).toThrow();
 });
 it("fails closed on missing keys or tampered encrypted bytes",()=>{
  const sealed=encodeLessonEvent(event(),keys),badKeys={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,8)}};
  expect(()=>decodeLessonEvent(sealed.header,sealed.ciphertext,badKeys)).toThrow();
  const body=JSON.parse(sealed.ciphertext);body.tag="a".repeat(22);
  expect(()=>decodeLessonEvent(sealed.header,JSON.stringify(body),keys)).toThrow();
 });
});
