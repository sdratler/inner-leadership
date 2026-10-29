import {createHmac,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {readFishingMarketingSchemaStage} from "../../src/db/fishing-marketing-schema-release.ts";
import {FishingMarketingStore} from "../../src/features/fishing-marketing/store.ts";
import {receiveFishingMarketing} from "../../src/features/fishing-marketing/http.ts";
import {canonical} from "../../src/features/contact-ops/core/validation.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
const db=new PGlite(),ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,4)}};
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const now=new Date("2026-10-29T12:00:00Z"),workspace=asId(randomUUID(),"workspace"),owner=randomUUID(),other=randomUUID(),h="a".repeat(64);
const store=new FishingMarketingStore(adapter,workspace,ring,"synthetic-fishing-private-digest-key",owner,{now:()=>now});
const actor=async(id:string,role:"practitioner"|"parent")=>{const digest=id.replaceAll("-","").padEnd(64,"0");
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$5,'active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[id,workspace,digest,now,role]);
 await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,id]);
 await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspace,id,now,new Date("2035-01-01")]);
 return {id,workspaceId:workspace,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:new Date("2035-01-01").getTime()} as Actor;};
let ownerActor:Actor,otherActor:Actor;
const snapshot={schemaVersion:1,program:"fishing",channel:"facebook_group_manual",mode:"assisted",generatedAt:"2026-10-29T11:00:00Z",
 schedule:{timezone:"America/New_York",dailyCap:5,cooldownDays:30,enabled:true,funnelReady:false,day:"2026-10-29",window:"waiting",nextDue:"2026-10-29T14:00:00Z",lastRun:null},
 assets:[{id:"approved",language:"en",caption:"Synthetic private caption",captionSha256:h,imageSha256:h}],targets:[],items:[],itemsTruncated:false,history:[],historyAvailable:false,historyTruncated:false,excludedHistory:0};
beforeAll(async()=>{await db.exec("CREATE SCHEMA ls_control");for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql","0131_ls_public_group_applications.sql","0139_ls_bna_inquiries.sql","0140_ls_fishing_inquiry_followups.sql","0141_ls_owner_305_conversations.sql","0145_ls_owner_305_inbound.sql","0147_ls_fishing_marketing_snapshot.sql"])await db.exec(await readFile("migrations/"+name,"utf8"));
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);ownerActor=await actor(owner,"practitioner");otherActor=await actor(other,"parent");},30000);
afterAll(async()=>db.close());
it("encrypts, replays, orders and restricts the Fishing projection to the owner",async()=>{
 expect(await store.read(ownerActor)).toBeNull();const first=await store.save(snapshot);expect(first.replayed).toBe(false);
 expect(await store.save(snapshot)).toEqual({...first,replayed:true});
 await expect(store.save({...snapshot,assets:[{...snapshot.assets[0],caption:"changed"}]})).rejects.toMatchObject({code:"CONFLICT"});
 await expect(store.save({...snapshot,generatedAt:"2026-10-29T10:00:00Z"})).rejects.toMatchObject({code:"CONFLICT"});
 await expect(store.save({...snapshot,generatedAt:"2026-10-30T12:00:00Z"})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(store.read(otherActor)).rejects.toMatchObject({code:"NOT_FOUND"});
 expect((await store.read(ownerActor))?.snapshot.assets[0]?.caption).toBe("Synthetic private caption");
 const rows=await db.query<{payload_ciphertext:string}>("SELECT payload_ciphertext FROM ls_service_interest.fishing_marketing_snapshot");expect(rows.rows[0]!.payload_ciphertext).not.toContain("Synthetic private caption");
 const later={...snapshot,generatedAt:"2026-10-29T11:30:00Z"};expect((await store.save(later)).replayed).toBe(false);
 expect((await store.read(ownerActor))?.snapshot.generatedAt).toBe(later.generatedAt);
 await expect(db.query("DELETE FROM ls_service_interest.fishing_marketing_snapshot")).rejects.toThrow();
});

it("acknowledges only a committed authenticated bridge snapshot",async()=>{
 const secret="synthetic-fishing-bridge-secret-not-real",payload={...snapshot,generatedAt:"2026-10-29T11:45:00Z"};
 const env={LS_FISHING_MARKETING_ENABLED:"true",LS_FISHING_MARKETING_BRIDGE_SECRET:secret,LS_BNA_OWNER_ACCOUNT_ID:owner};
 const request=()=>new Request("https://synthetic.invalid/api/private/fishing-marketing",{method:"POST",headers:{"content-type":"application/json","x-fishing-marketing-secret":secret},body:JSON.stringify(payload)});
 const response=await receiveFishingMarketing(request(),env,async()=>store);expect(response.status).toBe(201);
 const expected=createHmac("sha256",secret).update("fishing-marketing-ack/v1\n").update(canonical(payload)).digest("hex");
 expect((await response.json()).data.ackDigest).toBe(expected);expect((await store.read(ownerActor))?.snapshot.generatedAt).toBe(payload.generatedAt);
 expect((await receiveFishingMarketing(request(),env,async()=>store)).status).toBe(200);
});

it('retains group timing facts through encrypted owner readback and an identical replay',async()=>{
 const preparation={status:'cooldown',nextEligibleAt:'2026-11-04T19:29:23Z',lastPublishedAt:'2026-10-28T19:29:23Z',rulesCheckedAt:'2026-10-28T12:00:00Z',canPrepare:false};
 const value={...snapshot,generatedAt:'2026-10-29T11:50:00Z',historyAvailable:true,targets:[{id:'123',name:'Synthetic group',url:'https://www.facebook.com/groups/123',eligible:true,hold:null,preparation}]};
 const before=await db.query('SELECT count(*) FROM ls_identity.people');
 expect((await store.save(value)).replayed).toBe(false);
 expect((await store.save(value)).replayed).toBe(true);
 expect((await store.read(ownerActor))?.snapshot.targets[0]?.preparation).toEqual(preparation);
 expect((await db.query('SELECT count(*) FROM ls_identity.people')).rows).toEqual(before.rows);
 const stored=await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_service_interest.fishing_marketing_snapshot');
 expect(stored.rows[0]!.payload_ciphertext).not.toContain('nextEligibleAt');
});

it("does not expose an altered or corrupt snapshot",async()=>{
 await db.query("UPDATE ls_service_interest.fishing_marketing_snapshot SET payload_ciphertext='corrupt' WHERE workspace_id=$1",[workspace]);
 await expect(store.read(ownerActor)).rejects.toMatchObject({code:"UNAVAILABLE"});
});

it("checks the additive schema catalog and rejects missing protections",async()=>{
 const query={query:<T extends object>(sql:string,values?:readonly unknown[])=>db.query<T>(sql,values?[...values]:undefined)};
 expect(await readFishingMarketingSchemaStage(query)).toBe(1);
 await db.exec("DROP TRIGGER fishing_marketing_no_delete ON ls_service_interest.fishing_marketing_snapshot");
 await expect(readFishingMarketingSchemaStage(query)).rejects.toThrow("FISHING_MARKETING_SCHEMA_CATALOG_CONFLICT");
});
