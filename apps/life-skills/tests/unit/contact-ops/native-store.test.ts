import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {NativeCrmStore,type CrmProfile} from "../../../src/features/contact-ops/server/native-store.ts";
import type {IdentityStore,SqlSession} from "../../../src/features/identity/store.ts";
import {asId} from "../../../src/lib/ids.ts";
import type {Actor,AccountRole,AccountState} from "../../../src/features/identity/types.ts";

const actor:Actor={workspaceId:asId("00000000-0000-4000-8000-000000000001","workspace"),id:asId("00000000-0000-4000-8000-000000000002","account"),personId:asId("00000000-0000-4000-8000-000000000003","person"),role:"practitioner",state:"active",locale:"en",sessionDigest:"a".repeat(64),expiresAt:Date.now()+3600000};
const profile:CrmProfile={personId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",stage:"new",nextAction:"Call",followUpDate:"2026-09-26",notes:"Synthetic administrative note",legacyIds:["LS-LEAD-DEMO-01"]};
const ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,7)}};
const key="synthetic-test-integrity-key-123456789";

function fixture(){
 const state={cipher:"",version:1,recordMode:"" as string,demoBatch:null as string|null,receipts:new Map<string,{payload_digest:string;result_version:number;actor_account_id:string;person_id:string}>(),statements:[] as string[],sessionActive:true,accountRole:"practitioner" as AccountRole,accountState:"active" as AccountState};
 const db:IdentityStore={async transaction<T>(fn:(tx:SqlSession)=>Promise<T>){
  const before={cipher:state.cipher,version:state.version,recordMode:state.recordMode,receipts:new Map(state.receipts)};
  try{return await fn({async query<R extends object=Record<string,unknown>>(sql:string,values:readonly unknown[]=[]):Promise<R[]>{
   state.statements.push(sql);
   if(sql.startsWith("SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE"))return [{id:actor.workspaceId}] as R[];
   if(sql.startsWith("SELECT a.id FROM ls_identity.sessions"))return (state.sessionActive?[{id:actor.id}]:[]) as R[];
   if(sql.includes("FROM ls_identity.accounts a"))return [{id:actor.id,workspaceId:actor.workspaceId,personId:actor.personId,role:state.accountRole,state:state.accountState,locale:"en"}] as R[];
   if(sql.includes("pg_advisory_xact_lock"))return [];
   if(sql.startsWith("SELECT payload_digest")){const item=state.receipts.get(String(values[1]));return (item?[item]:[]) as R[];}
   if(sql.startsWith("SELECT batch_id AS \"batchId\" FROM ls_demo.records"))return (state.demoBatch?[{batchId:state.demoBatch}]:[]) as R[];
   if(sql.startsWith("SELECT payload_ciphertext"))return (state.cipher?[{payload_ciphertext:state.cipher,version:state.version}]:[]) as R[];
   if(sql.startsWith("INSERT INTO ls_contact_ops.profiles")){if(state.cipher)return [];state.cipher=String(values[2]);state.recordMode=String(values[3]);return [{version:1}] as R[];}
   if(sql.startsWith("UPDATE ls_contact_ops.profiles")){if(values[0]!==actor.workspaceId||values[1]!==profile.personId||values[3]!==state.version)return [];state.version++;state.cipher=String(values[2]);return [{version:state.version}] as R[];}
   if(sql.startsWith("INSERT INTO ls_contact_ops.command_receipts")){state.receipts.set(String(values[1]),{payload_digest:String(values[4]),result_version:Number(values[5]),actor_account_id:String(values[3]),person_id:String(values[2])});return [];}
   throw Error("UNEXPECTED_SYNTHETIC_SQL");
  }});}catch(error){state.cipher=before.cipher;state.version=before.version;state.recordMode=before.recordMode;state.receipts=before.receipts;throw error;}
 }};
 return {state,store:new NativeCrmStore(db,ring,key)};
}

describe("native CRM profile candidate with existing encrypted store",()=>{
 it("creates one encrypted profile, replays the exact command, and rejects collisions",async()=>{
  const {state,store}=fixture();
  expect(await store.create(actor,profile,"create-op")).toEqual({version:1,replayed:false});
  expect(state.cipher).not.toContain(profile.notes);
  expect(state.recordMode).toBe("live");
  expect(state.statements.some(sql=>sql.includes("ls_identity.workspaces WHERE id=$1 FOR UPDATE"))).toBe(true);
  expect(await store.create(actor,profile,"create-op")).toEqual({version:1,replayed:true});
  await expect(store.create(actor,{...profile,notes:"other"},"create-op")).rejects.toThrow("OPERATION_REUSED_WITH_DIFFERENT_INPUT");
  await expect(store.create(actor,profile,"other-op")).rejects.toThrow("PROFILE_ALREADY_EXISTS");
  expect(state.receipts.size).toBe(1);
 });
 it("derives demo mode from immutable person provenance, never from the request",async()=>{
  const {state,store}=fixture();state.demoBatch="ls-owner-20260925";
  await store.create(actor,profile,"demo-create");
  expect(state.recordMode).toBe("demo");
  expect(state.statements.find(sql=>sql.includes("INSERT INTO ls_contact_ops.profiles"))).toContain("demo_batch_id");
 });
 it("rejects noncanonical person IDs before encryption, persistence or replay",async()=>{
  const {state,store}=fixture(),uppercase={...profile,personId:profile.personId.toUpperCase()};
  await expect(store.create(actor,uppercase,"uppercase-create")).rejects.toThrow("CANONICAL_PERSON_ID_REQUIRED");
  await expect(store.update(actor,uppercase,1,"uppercase-update")).rejects.toThrow("CANONICAL_PERSON_ID_REQUIRED");
  await expect(store.read(actor,uppercase.personId)).rejects.toThrow("CANONICAL_PERSON_ID_REQUIRED");
  expect(state.statements).toEqual([]);
 });
 it("saves and reads encrypted synthetic profile under the same person AAD",async()=>{
  const {state,store}=fixture();
  await store.create(actor,profile,"seed-profile");
  expect(await store.update(actor,profile,1,"synthetic-op")).toEqual({version:2,replayed:false});
  expect(state.cipher).not.toContain(profile.notes);
  expect(await store.read(actor,profile.personId)).toMatchObject({version:2,profile});
  await expect(store.read(actor,"different-person")).rejects.toThrow();
 });
 it("replays one command once and rejects reused operation IDs or stale versions",async()=>{
  const {state,store}=fixture();await store.create(actor,profile,"seed-profile");await store.update(actor,profile,1,"synthetic-op");
  expect(await store.update(actor,profile,1,"synthetic-op")).toEqual({version:2,replayed:true});
  expect(state.version).toBe(2);
  await expect(store.update(actor,{...profile,notes:"Different synthetic note"},1,"synthetic-op")).rejects.toThrow("OPERATION_REUSED_WITH_DIFFERENT_INPUT");
  await expect(store.update(actor,profile,1,"second-op")).rejects.toThrow("STALE_PROFILE_VERSION");
 });
 it("revalidates the actual session and role before every private read or write",async()=>{
  const {state,store}=fixture();
  await store.create(actor,profile,"seed-profile");
  state.sessionActive=false;
  await expect(store.read(actor,profile.personId)).rejects.toThrow("UNAUTHENTICATED");
  state.sessionActive=true;state.accountRole="parent";
  await expect(store.update(actor,profile,1,"denied-op")).rejects.toThrow("FORBIDDEN");
  state.accountRole="practitioner";state.accountState="revoked";
  await expect(store.read(actor,profile.personId)).rejects.toThrow("UNAUTHENTICATED");
  state.accountState="active";
  await store.update(actor,{...profile,notes:"'; DROP TABLE x;--"},1,"synthetic-op");
  expect(state.statements.every(sql=>!sql.includes("DROP TABLE"))).toBe(true);
 });
 it("a locked update cannot manufacture a missing profile or command receipt",async()=>{
  const {state,store}=fixture();
  await expect(store.update(actor,profile,1,"missing-profile")).rejects.toThrow("STALE_PROFILE_VERSION");
  expect(state.cipher).toBe("");expect(state.version).toBe(1);expect(state.receipts.size).toBe(0);
  expect(state.statements.some(sql=>sql.includes("SELECT payload_ciphertext FROM ls_contact_ops.profiles")&&sql.endsWith("FOR UPDATE"))).toBe(true);
  expect(state.statements.some(sql=>sql.startsWith("UPDATE ls_contact_ops.profiles"))).toBe(false);
 });
});
