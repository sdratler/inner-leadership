import {afterAll,beforeAll,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {academyTestDatabase,academyWorkspace} from "./academy-free-registration-fixture.ts";
import {poolStore} from "./calendar/fixture.ts";
import {FishingMarketingStore} from "../../src/features/fishing-marketing/store.ts";
import {receiveFishingMarketing} from "../../src/features/fishing-marketing/http.ts";
import {readFishingMarketingSchemaStage} from "../../src/db/fishing-marketing-schema-release.ts";
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
