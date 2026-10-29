import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {PublicGroupApplicationStore} from "../../src/features/group-application/store.ts";
import {FishingInquiryFollowupStore} from "../../src/features/group-application/fishing-followup-store.ts";
import {AcademyFounderStore} from "../../src/features/group-application/academy-founder-store.ts";
import {ACADEMY_CAMPAIGN,PREREG_CREATIVE,campaignAttributionSchema} from "../../src/features/group-application/academy-campaign-contract.ts";
import {floridaGroupApplicationNotice,groupApplicationNotice} from "../../src/features/group-application/contract.ts";
import {seal} from "../../src/features/identity/crypto.ts";
import {privateDigest} from "../../src/features/contact-ops/server/digests.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";

const db=new PGlite(),workspace=asId(randomUUID(),"workspace"),now=new Date("2026-10-29T00:00:00Z");
const ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,17)}},key="synthetic-fishing-followup-digest-key";
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const clock={now:()=>now},founder=new AcademyFounderStore(adapter,workspace,ring,key,clock);
const applications=new PublicGroupApplicationStore(adapter,workspace,ring,key,clock,false,founder);
const actors:Actor[]=[];
async function account(role:"practitioner"|"parent"){
 const id=randomUUID(),digest=id.replaceAll("-","").padEnd(64,"0");
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspace,role,digest,now]);
 await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,id]);
 await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspace,id,now,new Date("2035-01-01")]);
 return {id,workspaceId:workspace,personId:id,role,state:"active",locale:"en",sessionDigest:digest,
  expiresAt:new Date("2035-01-01").getTime()} as Actor;
}
beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");
 const manifest=JSON.parse(await readFile("migrations/manifest.json","utf8")) as {name:string;sha256:string}[];
 for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql",
  "0131_ls_public_group_applications.sql","0135_ls_inquiry_email_outbox.sql",
  "0136_ls_academy_founder.sql","0140_ls_fishing_inquiry_followups.sql"]){
  const sql=await readFile("migrations/"+name,"utf8");
  expect(createHash("sha256").update(sql).digest("hex")).toBe(manifest.find(row=>row.name===name)?.sha256);
  await db.exec(sql);
 }
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
 actors.push(await account("practitioner"),await account("parent"));
},30000);
afterAll(async()=>db.close());
it("keeps one encrypted owner follow-up on an email-only Fishing inquiry across replay and readback",async()=>{
 const owner=actors[0]!,parent=actors[1]!;
 const followups=new FishingInquiryFollowupStore(adapter,workspace,ring,key,owner.id,{now:()=>now});
 const attribution=campaignAttributionSchema.parse({first:{campaign:ACADEMY_CAMPAIGN,source:"facebook",medium:"social",
  content:PREREG_CREATIVE.id,postRef:"approved_post_1",groupRef:"group_1"},
  last:{campaign:ACADEMY_CAMPAIGN,source:"facebook",medium:"social",
   content:PREREG_CREATIVE.id,postRef:"approved_post_1",groupRef:"group_1"}});
 const submission:Parameters<typeof applications.submit>[0]={operationId:randomUUID(),fields:{parentName:"Synthetic Parent",
  contact:"fishing-parent@example.invalid",language:"en",childAge:"10",cityArea:"Florida",
  programId:"sunday_fishing_academy",schedulePreference:["sunday"],
  permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}}};
 const saved=await applications.submit(submission,undefined,attribution);
 expect(await applications.submit(submission,undefined,attribution)).toMatchObject({replayed:true,duplicate:true});
 await expect(applications.submit(submission,undefined,null)).rejects.toMatchObject({code:"CONFLICT"});
 const initial=await followups.read(owner,saved.item.id);
 expect(initial.followup).toMatchObject({version:0,status:"new",nextAction:"Review inquiry"});
 expect(initial.attribution).toEqual(attribution);
 const before=(await db.query("SELECT count(*)::int AS n FROM ls_identity.people")).rows;
 const command={operationId:randomUUID(),applicationId:saved.item.id,expectedVersion:0,status:"waiting" as const,
  note:"Parent requested a call next week",nextAction:"Call parent",dueDate:"2026-11-05",waitingCondition:"Parent availability"};
 expect(await followups.followup(owner,command)).toMatchObject({version:1,replayed:false});
 expect(await followups.followup(owner,command)).toMatchObject({version:1,replayed:true});
 await expect(followups.followup(owner,{...command,operationId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});
 const read=await followups.read(owner,saved.item.id);
 expect(read.followup).toMatchObject({version:1,note:command.note,nextAction:command.nextAction});
 expect(read.history).toHaveLength(1);
 await expect(followups.read(parent,saved.item.id)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(followups.read(owner,randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 const retiredId=randomUUID(),retiredFields={parentName:"Synthetic retired parent",parentPhone:"+972520000001",
  language:"he",childAge:10,town:"Modiin",townChoice:"modiin",neighborhood:"Synthetic",
  schedulePreference:"evening",observations:{},permission:{confirmed:true,version:groupApplicationNotice.version,language:"he"}};
 await db.query(`INSERT INTO ls_service_interest.public_applications
  (workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[workspace,retiredId,privateDigest({retiredId},key),
  privateDigest({domain:"public-group-application/v1",workspace,fields:retiredFields},key),
  seal(JSON.stringify(retiredFields),`ls_service_interest/public_application/v1/${workspace}/${retiredId}`,ring),
  groupApplicationNotice.version,"he",now]);
 await expect(followups.read(owner,retiredId)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(followups.followup(owner,{...command,operationId:randomUUID(),applicationId:retiredId}))
  .rejects.toMatchObject({code:"NOT_FOUND"});
 const secondTouch=campaignAttributionSchema.parse({first:attribution.first,last:{campaign:ACADEMY_CAMPAIGN,source:"whatsapp",medium:"message",content:PREREG_CREATIVE.id}});
 expect(await applications.submit({...submission,operationId:randomUUID()},undefined,secondTouch)).toMatchObject({duplicate:true});
 const attributed=await followups.read(owner,saved.item.id);expect(attributed.attribution).toEqual(secondTouch);
 const batch=await followups.listPage(owner);expect(batch.items).toHaveLength(1);
 expect(batch.items[0]).toMatchObject({application:{id:saved.item.id},attribution:secondTouch,followup:{version:1,status:"waiting",nextAction:"Call parent"}});
 await expect(followups.listPage(parent)).rejects.toMatchObject({code:"NOT_FOUND"});
 expect((await db.query("SELECT count(*)::int AS n FROM ls_identity.people")).rows).toEqual(before);
 const row=(await db.query<{payload_ciphertext:string}>("SELECT payload_ciphertext FROM ls_service_interest.fishing_inquiry_followups WHERE application_id=$1",[saved.item.id])).rows[0]!;
 expect(row.payload_ciphertext).not.toContain(command.note);
 await expect(db.query("DELETE FROM ls_service_interest.fishing_inquiry_followups WHERE application_id=$1",[saved.item.id])).rejects.toThrow();
});

it("pages owner-scoped Fishing inquiries with their saved follow-up and no duplicates",async()=>{
 const owner=actors[0]!,parent=actors[1]!,followups=new FishingInquiryFollowupStore(adapter,workspace,ring,key,owner.id,clock),ids=new Set<string>();
 for(let n=0;n<51;n++){
  const saved=await applications.submit({operationId:randomUUID(),fields:{parentName:`Synthetic parent ${n}`,contact:`batch-${n}@example.invalid`,language:"en",cityArea:"Florida",programId:"sunday_fishing_academy",schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}}});
  ids.add(saved.item.id);
 }
 const first=await followups.listPage(owner);expect(first.items).toHaveLength(50);expect(first.nextCursor).toBeTruthy();
 const second=await followups.listPage(owner,first.nextCursor!);expect(second.nextCursor).toBeNull();
 const all=[...first.items,...second.items];expect(new Set(all.map(item=>item.application.id)).size).toBe(all.length);
 for(const id of ids)expect(all.some(item=>item.application.id===id)).toBe(true);
 expect(all.find(item=>item.followup.version===1)?.followup).toMatchObject({status:"waiting",nextAction:"Call parent"});
 await expect(followups.listPage(parent,first.nextCursor!)).rejects.toMatchObject({code:"NOT_FOUND"});
 const bad=first.nextCursor!.slice(0,-1)+(first.nextCursor!.endsWith("A")?"B":"A");
 await expect(followups.listPage(owner,bad)).rejects.toMatchObject({code:"INVALID_REQUEST"});
},30000);
