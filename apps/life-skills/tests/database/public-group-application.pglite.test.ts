import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {PublicGroupApplicationStore} from "../../src/features/group-application/store.ts";
import {floridaGroupApplicationNotice,academyApplicationNotice,groupApplicationNotice,type LegacyFloridaParentApplicationFields as FloridaParentApplicationFields,type IsraelGroupApplicationCommand} from "../../src/features/group-application/contract.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import {asId} from "../../src/lib/ids.ts";
import {floridaAcademyRegistrationFieldsSchema} from '../../src/features/group-application/contract.ts';
import {ACADEMY_REGISTRATION_VERSION,registrationConsent} from '../../src/features/group-application/academy-registration.ts';
import {academyRegistrationNotice} from '../../src/features/group-application/academy-registration-notice.ts';

const db=new PGlite(),workspaceId=asId(randomUUID(),"workspace"),now=new Date("2029-01-01T12:00:00Z"),ring={activeKeyId:"test",keys:{test:Buffer.alloc(32,9)}},key="synthetic-public-group-application-digest-key";
const identity:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>(await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const service=new PublicGroupApplicationStore(identity,workspaceId,ring,key,{now:()=>now});
const actors:Actor[]=[];
function command(overrides:Partial<FloridaParentApplicationFields>={}):{operationId:string;fields:FloridaParentApplicationFields}{return {operationId:randomUUID(),fields:{parentName:"Synthetic Parent",contact:"parent@example.invalid",language:"en",childAge:"10",cityArea:"Hollywood, Florida",neighborhood:"Synthetic neighborhood",programId:"sunday_fishing_academy",schedulePreference:["sunday","flexible"],scheduleNotes:"Synthetic practical scheduling only.",permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"},...overrides}};}
function israelCommand():IsraelGroupApplicationCommand{return {operationId:randomUUID(),fields:{parentName:"Synthetic Israel Parent",parentPhone:"+972520009999",language:"he",childAge:10,town:"Modiin",townChoice:"modiin",neighborhood:"Synthetic neighborhood",schedulePreference:"evening",observations:{},permission:{confirmed:true,version:groupApplicationNotice.version,language:"he"}}};}
beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql","0131_ls_public_group_applications.sql"]){const sql=await readFile("migrations/"+name,"utf8"),manifest=JSON.parse(await readFile("migrations/manifest.json","utf8")) as {name:string;sha256:string}[];expect(createHash("sha256").update(sql).digest("hex")).toBe(manifest.find(row=>row.name===name)?.sha256);await db.exec(sql);}
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspaceId,now]);
 for(const role of ["practitioner","parent"] as const){const id=randomUUID(),digest=id.replaceAll("-","").padEnd(64,"0");await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspaceId,now]);await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspaceId,role,digest,now]);await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspaceId,id]);await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspaceId,id,now,new Date(now.getTime()+86400000)]);actors.push({id,workspaceId,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:now.getTime()+86400000} as Actor);}
},20000);
afterAll(async()=>db.close());
it.each(["callback","enrollment_followup"] as const)("durably replays and privately reads the new Academy %s consent, exact age and 120-minute limit",async nextStep=>{
 const input=command({contact:`${nextStep}@example.invalid`,childAge:undefined,
  permission:{confirmed:true,version:academyApplicationNotice.version,language:"en"},scheduleContext:"program_format_interest",
  academyFit:{version:"RM-FIT-20261014-04-v1",maximumDriveMinutes:120,parentDropoff:"yes",learners:[{approximateAge:12,gear:"has_gear",experience:"new"}]},
  academyIntake:{version:"JLFA-ENROLLMENT-20261018-03-v1",postalCode:"33431",driveLimit:120,preferredGroupLanguage:"en",stagePreference:"foundation",keysTravel:"parent_drive",offshoreInterest:"discuss",nextStep,learners:[{ageYears:12,gradeBand:"grade_6_8",schooling:"school",tackleBox:"ready"}]}});
 // Zod removes explicitly undefined fields; match the actual accepted command.
 delete input.fields.childAge;
 const first=await service.submit(input),replay=await service.submit(input);
 expect(replay).toMatchObject({duplicate:true,replayed:true,item:{id:first.item.id,fields:input.fields}});
 expect(await service.list(actors[0]!)).toContainEqual(first.item);
 await expect(service.list(actors[1]!)).rejects.toMatchObject({code:"FORBIDDEN"});
 const row=await db.query<{notice_version:string;payload_ciphertext:string}>("SELECT notice_version,payload_ciphertext FROM ls_service_interest.public_applications WHERE id=$1",[first.item.id]);
 expect(row.rows[0]!.notice_version).toBe(academyApplicationNotice.version);expect(row.rows[0]!.payload_ciphertext).not.toContain(input.fields.contact);
 const count=await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_service_interest.public_application_operations WHERE application_id=$1",[first.item.id]);expect(count.rows[0]!.n).toBe(1);
});
it("encrypts one public application, reads it only as practitioner, and creates no CRM, case, payment or message side effect",async()=>{
 const before=await db.query("SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.cases) AS cases");const input=command(),saved=await service.submit(input);
 expect(saved).toMatchObject({saved:true,replayed:false,duplicate:false,item:{source:"public_group_application",state:"owner_review",fields:input.fields}});
 expect(await service.list(actors[0]!)).toContainEqual(saved.item);await expect(service.list(actors[1]!)).rejects.toMatchObject({code:"FORBIDDEN"});
 const stored=await db.query<{payload_ciphertext:string}>("SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE id=$1",[saved.item.id]);expect(stored.rows[0]!.payload_ciphertext).not.toContain(input.fields.contact);expect(stored.rows[0]!.payload_ciphertext).not.toContain(input.fields.parentName);
 expect((await db.query("SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.cases) AS cases")).rows).toEqual(before.rows);
 const names=(await db.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='ls_service_interest' ORDER BY table_name")).rows.map(row=>row.table_name);
 expect(names).toEqual(["inquiries","operations","public_application_operations","public_applications"]);
});
it("replays exact operations, deduplicates exact new operations and preserves changed submissions for the same contact",async()=>{
 const input=command({contact:"+15550003001"}),first=await service.submit(input),replay=await service.submit(input);expect(replay).toMatchObject({replayed:true,duplicate:true,item:{id:first.item.id}});
 await expect(service.submit({...input,fields:{...input.fields,childAge:"11"}})).rejects.toMatchObject({code:"CONFLICT"});
 const duplicate=await service.submit({...input,operationId:randomUUID()});expect(duplicate).toMatchObject({replayed:false,duplicate:true,item:{id:first.item.id}});
 expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_service_interest.public_application_operations WHERE application_id=$1",[first.item.id])).rows[0]!.n).toBe(2);
 const changed=await service.submit(command({contact:input.fields.contact,childAge:"11"}));expect(changed.item.id).not.toBe(first.item.id);
 expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_service_interest.public_applications WHERE workspace_id=$1",[workspaceId])).rows[0]!.n).toBeGreaterThanOrEqual(3);
});
it("bounds repeated distinct submissions per contact and keeps append-only evidence",async()=>{
 const contact="+15550003999",saved=[];for(let i=0;i<4;i++)saved.push(await service.submit(command({contact,childAge:String(6+i)})));
 await expect(service.submit(command({contact,childAge:"12"}))).rejects.toMatchObject({code:"RATE_LIMITED"});
 await expect(db.query("UPDATE ls_service_interest.public_applications SET notice_language='he' WHERE id=$1",[saved[0]!.item.id])).rejects.toThrow("public_group_application_append_only");
 await expect(db.query("DELETE FROM ls_service_interest.public_application_operations WHERE application_id=$1",[saved[0]!.item.id])).rejects.toThrow("public_group_application_append_only");
});
it("retains durable no-query Israel submission storage and practitioner readback",async()=>{
 const input=israelCommand(),saved=await service.submit(input);expect(saved).toMatchObject({saved:true,replayed:false,duplicate:false,item:{fields:input.fields}});
 expect(await service.list(actors[0]!)).toContainEqual(saved.item);
 const stored=await db.query<{payload_ciphertext:string;notice_version:string;notice_language:string}>("SELECT payload_ciphertext,notice_version,notice_language FROM ls_service_interest.public_applications WHERE id=$1",[saved.item.id]);
 expect(stored.rows[0]).toMatchObject({notice_version:groupApplicationNotice.version,notice_language:"he"});expect(stored.rows[0]!.payload_ciphertext).not.toContain(input.fields.parentPhone);
});

it("searches durable encrypted history beyond50, continues empty bounded scans, and pages without skipping tied timestamps",async()=>{
 const target=await service.submit(command({parentName:"Synthetic oldest unique search family",contact:"search-target@example.invalid"}));
 for(let i=0;i<205;i++){
  now.setTime(now.getTime()+1000);
  await service.submit(command({parentName:`Synthetic recent family ${i}`,contact:`recent-${i}@example.invalid`}));
 }
 expect((await service.list(actors[0]!)).some(item=>item.id===target.item.id)).toBe(false);
 const first=await service.listPage(actors[0]!,{search:"OLDEST UNIQUE SEARCH FAMILY"});
 expect(first.items).toEqual([]);expect(first.nextCursor).not.toBeNull();
 const second=await service.listPage(actors[0]!,{search:"OLDEST UNIQUE SEARCH FAMILY",cursor:first.nextCursor!});
 expect(second.items).toEqual([target.item]);expect(second.nextCursor).toBeNull();
 const ids:string[]=[];let cursor:string|undefined;
 do{const page=await service.listPage(actors[0]!,{cursor});ids.push(...page.items.map(item=>item.id));cursor=page.nextCursor??undefined;}while(cursor);
 const count=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_service_interest.public_applications WHERE workspace_id=$1",[workspaceId])).rows[0]!.n;
 expect(ids).toHaveLength(count);expect(new Set(ids).size).toBe(count);
 await expect(service.listPage(actors[1]!,{search:"Synthetic"})).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(service.listPage({...actors[0]!,workspaceId:asId(randomUUID(),"workspace")},{search:"Synthetic"})).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(service.listPage(actors[0]!,{cursor:randomUUID()})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(service.listPage(actors[0]!,{search:"x".repeat(201)})).rejects.toMatchObject({code:"INVALID_REQUEST"});
},30000);
it('round-trips named exact-grade siblings and37minutes through the real encrypted store without financial or person effects',async()=>{
 const children=[{id:randomUUID(),fullName:'Synthetic Registered Child One',ageYears:10,grade:'5',schooling:'school',experience:'new'},{id:randomUUID(),fullName:'Synthetic Registered Child Two',ageYears:13,grade:'8',schooling:'homeschool',experience:'some'}];
 const fields=floridaAcademyRegistrationFieldsSchema.parse({parentName:'Synthetic Registered Guardian',contact:'+15555550876',cityArea:'Synthetic Florida',language:'en',programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:{version:ACADEMY_REGISTRATION_VERSION,learners:children,postalCode:'00123',preferredDays:['monday','wednesday'],preferredTimes:['afternoon'],driveMinutes:37,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'he',stageInterest:'discuss',intent:'information',consent:registrationConsent('en')},permission:{confirmed:true,version:academyRegistrationNotice.version,language:'en'}});
 const before=await db.query('SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.cases) AS cases');
 const input={operationId:randomUUID(),fields},first=await service.submit(input),replay=await service.submit(input);
 expect(replay).toMatchObject({replayed:true,item:{id:first.item.id,fields}});expect(first.item.receivedAt).toBe(now.toISOString());
 expect(await service.list(actors[0]!)).toContainEqual(first.item);await expect(service.list(actors[1]!)).rejects.toMatchObject({code:'FORBIDDEN'});
 const stored=(await db.query<{payload_ciphertext:string;notice_version:string;notice_language:string}>('SELECT payload_ciphertext,notice_version,notice_language FROM ls_service_interest.public_applications WHERE id=$1',[first.item.id])).rows[0]!;
 expect(stored.notice_version).toBe(academyRegistrationNotice.version);expect(stored.notice_language).toBe('en');for(const child of children)expect(stored.payload_ciphertext).not.toContain(child.fullName);
 expect((await db.query('SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.cases) AS cases')).rows).toEqual(before.rows);
 expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_service_interest.public_application_operations WHERE application_id=$1',[first.item.id])).rows[0]!.n).toBe(1);
 await expect(service.submit({...input,fields:{...fields,academyRegistration:{...fields.academyRegistration,driveMinutes:38}}})).rejects.toMatchObject({code:'CONFLICT'});
 await expect(service.submit({operationId:randomUUID(),fields:{...fields,academyRegistration:{...fields.academyRegistration,intent:'pay'}}})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(service.submit({operationId:randomUUID(),fields:{...fields,permission:{...fields.permission,version:academyApplicationNotice.version}}} as unknown as Parameters<typeof service.submit>[0])).rejects.toMatchObject({code:'INVALID_REQUEST'});
});
