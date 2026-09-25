import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {NativeCrmStore,type CrmProfile,type OwnerContext} from "../../../src/features/contact-ops/server/native-store.ts";
import type {IdentityStore,SqlSession} from "../../../src/features/identity/store.ts";

const actor:OwnerContext={workspaceId:"synthetic-workspace",accountId:"synthetic-owner",role:"practitioner",active:true};
const profile:CrmProfile={personId:"synthetic-person",stage:"new",nextAction:"Call",followUpDate:"2026-09-26",notes:"Synthetic administrative note",legacyIds:["LS-LEAD-DEMO-01"]};
const ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,7)}};
const key="synthetic-test-integrity-key-123456789";

function fixture(){
 const state={cipher:"",version:1,receipts:new Map<string,{payload_digest:string;result_version:number;actor_account_id:string;person_id:string}>(),statements:[] as string[]};
 const db:IdentityStore={async transaction<T>(fn:(tx:SqlSession)=>Promise<T>){
  const before={cipher:state.cipher,version:state.version,receipts:new Map(state.receipts)};
  try{return await fn({async query<R extends object=Record<string,unknown>>(sql:string,values:readonly unknown[]=[]):Promise<R[]>{
   state.statements.push(sql);
   if(sql.includes("pg_advisory_xact_lock"))return [];
   if(sql.startsWith("SELECT payload_digest")){const item=state.receipts.get(String(values[1]));return (item?[item]:[]) as R[];}
   if(sql.startsWith("SELECT payload_ciphertext"))return (state.cipher?[{payload_ciphertext:state.cipher,version:state.version}]:[]) as R[];
   if(sql.startsWith("UPDATE ls_contact_ops.profiles")){if(values[0]!==actor.workspaceId||values[1]!==profile.personId||values[3]!==state.version)return [];state.version++;state.cipher=String(values[2]);return [{version:state.version}] as R[];}
   if(sql.startsWith("INSERT INTO ls_contact_ops.command_receipts")){state.receipts.set(String(values[1]),{payload_digest:String(values[4]),result_version:Number(values[5]),actor_account_id:String(values[3]),person_id:String(values[2])});return [];}
   throw Error("UNEXPECTED_SYNTHETIC_SQL");
  }});}catch(error){state.cipher=before.cipher;state.version=before.version;state.receipts=before.receipts;throw error;}
 }};
 return {state,store:new NativeCrmStore(db,ring,key)};
}

describe("native CRM profile candidate with existing encrypted store",()=>{
 it("saves and reads encrypted synthetic profile under the same person AAD",async()=>{
  const {state,store}=fixture();
  expect(await store.update(actor,profile,1,"synthetic-op")).toEqual({version:2,replayed:false});
  expect(state.cipher).not.toContain(profile.notes);
  expect(await store.read(actor,profile.personId)).toMatchObject({version:2,profile});
  await expect(store.read(actor,"different-person")).rejects.toThrow();
 });
 it("replays one command once and rejects reused operation IDs or stale versions",async()=>{
  const {state,store}=fixture();await store.update(actor,profile,1,"synthetic-op");
  expect(await store.update(actor,profile,1,"synthetic-op")).toEqual({version:2,replayed:true});
  expect(state.version).toBe(2);
  await expect(store.update(actor,{...profile,notes:"Different synthetic note"},1,"synthetic-op")).rejects.toThrow("OPERATION_REUSED_WITH_DIFFERENT_INPUT");
  await expect(store.update(actor,profile,1,"second-op")).rejects.toThrow("STALE_PROFILE_VERSION");
 });
 it("denies non-practitioner/inactive context and never interpolates notes into SQL",async()=>{
  const {state,store}=fixture();
  await expect(store.read({...actor,active:false},profile.personId)).rejects.toThrow("NOT_FOUND");
  await expect(store.read({...actor,role:"parent" as OwnerContext["role"]},profile.personId)).rejects.toThrow("NOT_FOUND");
  await store.update(actor,{...profile,notes:"'; DROP TABLE x;--"},1,"synthetic-op");
  expect(state.statements.every(sql=>!sql.includes("DROP TABLE"))).toBe(true);
 });
});
