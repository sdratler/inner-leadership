import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore} from "../calendar/fixture.ts";
import {NativeCrmStore,type CrmProfile} from "../../../src/features/contact-ops/server/native-store.ts";

const f=await fixture({demoFirst:true});
afterAll(async()=>{await f.pool.end();});
const store=new NativeCrmStore(poolStore(f.pool),f.keyring,"synthetic-native-crm-integrity-key-20260926");
const profile=(personId:string,notes:string):CrmProfile=>({personId,stage:"new",nextAction:"Call",followUpDate:"2026-09-26",notes,legacyIds:[]});

test("native PostgreSQL creates encrypted live profile once and preserves replay/notes",async()=>{
 const p=profile(f.practitioner.actor.personId,"Synthetic private administrative note");
 const createId="native-create-"+randomUUID();
 expect(await store.create(f.practitioner.actor,p,createId)).toEqual({version:1,replayed:false});
 expect(await store.create(f.practitioner.actor,p,createId)).toEqual({version:1,replayed:true});
 await expect(store.create(f.practitioner.actor,p,"different-create-"+randomUUID())).rejects.toThrow("PROFILE_ALREADY_EXISTS");
 const rows=await f.pool.query("SELECT payload_ciphertext,record_mode,demo_batch_id FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,p.personId]);
 expect(rows.rows[0]?.record_mode).toBe("live");
 expect(rows.rows[0]?.demo_batch_id).toBeNull();
 expect(rows.rows[0]?.payload_ciphertext).not.toContain(p.notes);
 expect(await store.read(f.practitioner.actor,p.personId)).toMatchObject({version:1,profile:p});
 const changed={...p,notes:"Preserved replacement synthetic note"},updateId="native-update-"+randomUUID();
 expect(await store.update(f.practitioner.actor,changed,1,updateId)).toEqual({version:2,replayed:false});
 expect(await store.update(f.practitioner.actor,changed,1,updateId)).toEqual({version:2,replayed:true});
 await expect(store.update(f.practitioner.actor,p,1,"stale-"+randomUUID())).rejects.toThrow("STALE_PROFILE_VERSION");
 expect(await store.read(f.practitioner.actor,p.personId)).toMatchObject({version:2,profile:changed});
 await expect(f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,case_id) VALUES($1,$2,'person',$3,$4,$5)",
  [f.workspaceId,"ls-owner-20260925",p.personId,"late-person-"+randomUUID(),f.first.id])).rejects.toThrow("CONTACT_PROFILE_DEMO_PROVENANCE_CONFLICT");
 expect(await store.read(f.practitioner.actor,p.personId)).toMatchObject({version:2,profile:changed});
});

test("native PostgreSQL denies a non-practitioner and rejects unmarked demo mode",async()=>{
 const p=profile(f.parent.actor.personId,"Synthetic demo administrative note");
 await expect(store.create(f.parent.actor,p,"parent-denied")).rejects.toThrow("FORBIDDEN");
 await expect(f.pool.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,'cipher','demo',$3)",[f.workspaceId,p.personId,"ls-owner-20260925"])).rejects.toThrow("CONTACT_PROFILE_DEMO_PROVENANCE_REQUIRED");
 await f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,$2,'person',$3,$4,$5)",[f.workspaceId,"ls-owner-20260925",p.personId,"native-crm-parent-"+randomUUID(),f.parent.actor.id]);
 const receipt="demo-create-"+randomUUID();
 expect(await store.create(f.practitioner.actor,p,receipt)).toEqual({version:1,replayed:false});
 expect(await store.create(f.practitioner.actor,p,receipt)).toEqual({version:1,replayed:true});
 await expect(store.create(f.practitioner.actor,{...p,notes:"Different note"},receipt)).rejects.toThrow("OPERATION_REUSED_WITH_DIFFERENT_INPUT");
 const mode=await f.pool.query("SELECT record_mode,demo_batch_id FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,p.personId]);
 expect(mode.rows[0]).toMatchObject({record_mode:"demo",demo_batch_id:"ls-owner-20260925"});
});
