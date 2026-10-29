import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import pg from "pg";
vi.mock("server-only",()=>({}));
import {academyTestDatabase,academyWorkspace} from "./academy-free-registration-fixture.ts";
import {poolStore} from "./calendar/fixture.ts";
import {FishingMarketingStore} from "../../src/features/fishing-marketing/store.ts";
import {receiveFishingMarketing} from "../../src/features/fishing-marketing/http.ts";
import {readFishingMarketingSchemaStage} from "../../src/db/fishing-marketing-schema-release.ts";
import {historicalPracticeDatabase} from "./home-practice/legacy-practice-fixture.ts";
import {migrate} from "../../src/db/migration-runner.ts";
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BnaAcknowledgmentStore,configuredBnaAcknowledgmentQueue} from "../../src/features/bna-communications/acknowledgment-store.ts";
import {BNA_EMAIL_SOURCE} from "../../src/features/bna-communications/delivery-policy.ts";
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM} from "../../src/features/bna-inquiry/coop-contract.ts";
let db:Awaited<ReturnType<typeof academyTestDatabase>>,fixture:Awaited<ReturnType<typeof academyWorkspace>>;
beforeAll(async()=>{db=await academyTestDatabase();fixture=await academyWorkspace(db.pool);},60000);
afterAll(async()=>{await db?.close();});
it("commits one encrypted owner-only snapshot and replays concurrent bridge deliveries",async()=>{
 const at=new Date(Date.now()-1000).toISOString(),day=at.slice(0,10),secret="synthetic-fishing-bridge-secret-not-real";
 const payload={schemaVersion:1,program:"fishing",channel:"facebook_group_manual",mode:"assisted",generatedAt:at,
  schedule:{timezone:"America/New_York",dailyCap:5,cooldownDays:30,enabled:true,funnelReady:false,day,window:"waiting",nextDue:at,lastRun:null},assets:[],targets:[],items:[],itemsTruncated:false,history:[],historyAvailable:false,historyTruncated:false,excludedHistory:0};
 const env={LS_FISHING_MARKETING_ENABLED:"true",LS_FISHING_MARKETING_BRIDGE_SECRET:secret,LS_BNA_OWNER_ACCOUNT_ID:fixture.owner.actor.id};
 const store=new FishingMarketingStore(poolStore(db.pool),fixture.workspace,fixture.ring,fixture.digestKey,fixture.owner.actor.id);
 const request=()=>new Request("https://synthetic.invalid/api/private/fishing-marketing",{method:"POST",headers:{"content-type":"application/json","x-fishing-marketing-secret":secret},body:JSON.stringify(payload)});
 const counts=async()=> (await db.pool.query<{people:number;tasks:number}>(`SELECT (SELECT count(*)::int FROM ls_identity.people WHERE workspace_id=$1) AS people,(SELECT count(*)::int FROM ls_calendar.tasks WHERE workspace_id=$1) AS tasks`,[fixture.workspace])).rows[0];
 const before=await counts();expect(await readFishingMarketingSchemaStage({query:(sql,values)=>db.pool.query(sql,values?[...values]:undefined)})).toBe(1);
 const results=await Promise.all(Array.from({length:3},()=>receiveFishingMarketing(request(),env,async()=>store)));expect(results.map(r=>r.status).sort()).toEqual([200,200,201]);
 expect((await store.read(fixture.owner.actor))?.snapshot.generatedAt).toBe(at);await expect(store.read(fixture.parent.actor)).rejects.toMatchObject({code:"NOT_FOUND"});
 const stored=await db.pool.query<{payload_ciphertext:string}>("SELECT payload_ciphertext FROM ls_service_interest.fishing_marketing_snapshot WHERE workspace_id=$1",[fixture.workspace]);
 expect(stored.rowCount).toBe(1);expect(stored.rows[0]!.payload_ciphertext).not.toContain("facebook_group_manual");expect(await counts()).toEqual(before);
 await expect(db.pool.query("DELETE FROM ls_service_interest.fishing_marketing_snapshot WHERE workspace_id=$1",[fixture.workspace])).rejects.toThrow();
},60000);

it("upgrades only0147 after0146 and preserves a queued acknowledgment through failed and successful schema apply",async()=>{
 const history=await historicalPracticeDatabase("0118_ls_contact_delta_history.sql"),client=await history.pool.connect();
 const query=(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined);
 const servicePool=new pg.Pool({connectionString:history.url,ssl:false,max:2});
 try{
  const index=history.inventory.findIndex(file=>file.name==='0147_ls_fishing_marketing_snapshot.sql');expect(index).toBe(66);
  const baseline=history.inventory.slice(0,index),migration=history.inventory[index]!,target=history.inventory.slice(0,index+1);await migrate({query},baseline,false);
  const f=await academyWorkspace(servicePool),env={LS_BNA_EMAIL_QUEUE_ENABLED:'true',LS_BNA_EMAIL_SOURCE_SHA256:BNA_EMAIL_SOURCE,LS_BNA_EMAIL_QUEUE_SINCE:new Date(Date.now()-1000).toISOString()};
  const store=poolStore(servicePool),mail=new BnaAcknowledgmentStore(store,f.workspace,f.owner.actor.id,f.ring,f.digestKey,f.runtime.clock);
  const inquiries=new BnaInquiryStore(store,f.workspace,f.ring,f.digestKey,f.owner.actor.id,f.runtime.clock,configuredBnaAcknowledgmentQueue(env,f.ring,f.digestKey));
  const saved=await inquiries.submit({operationId:randomUUID(),fields:{name:'Synthetic retained B0',contactChannel:'email',contact:'retained-b0@example.invalid',language:'en',siteLanguage:'en',emailUpdates:false,townOrZip:'Synthetic',childAges:[10],permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:'en'}}},BNA_COOP_PROGRAM);
  const before=await mail.readForInquiry(f.owner.actor,saved.reference);expect(before.state).toBe('queued');
  const ledgerBefore=(await query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;
  expect(await readFishingMarketingSchemaStage({query})).toBe(0);
  await expect(migrate({query},[...baseline,{...migration,sql:migration.sql+'\nSELECT 1/0;'}],false)).rejects.toThrow('MIGRATION_FAILED');
  expect(await readFishingMarketingSchemaStage({query})).toBe(0);expect((await query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows).toEqual(ledgerBefore);
  expect(await mail.readForInquiry(f.owner.actor,saved.reference)).toEqual(before);
  expect(await migrate({query},target,false)).toEqual({applied:1,pending:0});expect(await readFishingMarketingSchemaStage({query})).toBe(1);
  expect(await mail.readForInquiry(f.owner.actor,saved.reference)).toEqual(before);expect(await migrate({query},target,true)).toEqual({applied:0,pending:0});
  expect(history.inventory.slice(index+1).map(file=>file.name)).toEqual(['0148_ls_bna_email_preferences.sql','0149_ls_bna_optional_calendar.sql']);
  expect(await migrate({query},history.inventory.slice(0,index+2),false)).toEqual({applied:1,pending:0});
  expect(await mail.readForInquiry(f.owner.actor,saved.reference)).toEqual(before);
  expect(await migrate({query},history.inventory,false)).toEqual({applied:1,pending:0});
  expect(await mail.readForInquiry(f.owner.actor,saved.reference)).toEqual(before);
  expect(await migrate({query},history.inventory,true)).toEqual({applied:0,pending:0});
  expect((await query('SELECT count(*)::int AS n FROM ls_service_interest.fishing_marketing_snapshot')).rows).toEqual([{n:0}]);
 }finally{await servicePool.end();client.release();await history.close();}
},60000);
