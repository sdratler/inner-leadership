/** Real retained auth, SQL and HTTP. All identities/source approvals are fresh
 * synthetic fixtures; no approved legal terms or real merchant are claimed. */
import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {academyFamilyFixture} from './academy-family-fixture.ts';
import {AcademyEnrollmentStore} from '../../../src/features/fishing/academy-enrollment-store.ts';
import {academyEnrollmentHttp} from '../../../src/features/fishing/academy-enrollment-http.ts';
import {academyEnrollmentVersion,type AcademyEnrollmentCommand} from '../../../src/features/fishing/academy-enrollment-contract.ts';
import {unseal} from '../../../src/features/identity/crypto.ts';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
const document='SYNTHETIC REGISTRATION TERMS — TEST ONLY. No actual service or charge.\nתנאי בדיקה בלבד. אין הרשמה לשירות אמיתי או חיוב.';
async function fixture(termsDocument:string|null=document,termsDocumentSha256?:string){
 const f=await academyFamilyFixture({... (termsDocument===null?{}:{termsDocument}),...(termsDocumentSha256===undefined?{}:{termsDocumentSha256})}),id=await f.inquiry();await f.promote(id);const familyCommand=await f.command(id),response=await f.post(familyCommand);expect(response.status).toBe(200);const family=(await response.json()).data.saved;
 const row=(await f.pool.query("SELECT id,payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND account_id=$2 AND kind='invite'",[f.workspaceId,family.parentAccountId])).rows[0],mail=JSON.parse(unseal(row.payload_ciphertext,`auth-mail:${f.workspaceId}:${row.id}`,f.ring));await f.auth.consumePasswordToken('invite',mail.token,'Ab12cd',randomUUID());
 const parentToken=await f.passwordLogin(familyCommand.parentEmail),parent=await f.sessions.actor(parentToken),store=new AcademyEnrollmentStore(f.db,f.config,f.store),endpoint='/api/private/group-applications/enrollment';
 const get=(query:string,token=f.token)=>academyEnrollmentHttp(new Request(f.config.origin+endpoint+'?'+query,{headers:{cookie:SESSION_COOKIE+'='+token}}),async()=>({runtime:f.runtime,store}));
 const post=(command:AcademyEnrollmentCommand,token=f.token,headers:Record<string,string>={})=>academyEnrollmentHttp(new Request(f.config.origin+endpoint,{method:'POST',headers:{cookie:SESSION_COOKIE+'='+token,origin:f.config.origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':f.sessions.csrf(token),'idempotency-key':command.operationId,...headers},body:JSON.stringify(command)}),async()=>({runtime:f.runtime,store}));
 const fitCommand=async()=>{const response=await get('applicationId='+id);expect(response.status).toBe(200);const context=(await response.json()).data;expect(context.role).toBe('practitioner');return {version:academyEnrollmentVersion,action:'fit' as const,operationId:randomUUID(),binding:context.binding,learnerIndex:0,stageId:f.ref.stageId,decision:'approved' as const,note:'PRIVATE_FIT_REVIEW_DO_NOT_PUBLISH'};};
 const termsCommand=()=>({version:academyEnrollmentVersion,action:'terms' as const,operationId:randomUUID(),learnerId:family.children[0].learnerId,stageId:f.ref.stageId,sourceApprovalId:f.termsId,sourceSha256:f.termsHash,termsVersion:'synthetic-terms-v1',accepted:true as const});
 const mailSnapshot=async()=>(await f.pool.query('SELECT to_jsonb(m) AS row FROM ls_identity.auth_mail_outbox m WHERE workspace_id=$1 ORDER BY id',[f.workspaceId])).rows;
 return {...f,id,savedFamily:family,parent,parentToken,enrollment:store,getEnrollment:get,postEnrollment:post,fitCommand,termsCommand,mailSnapshot};
}
test('same saved family gets deliberate fit and actual approved terms; exact concurrent retries save once without payment, enrollment, task or message',async()=>{
 const f=await fixture(),before=await f.protectedState(),mailBefore=await f.mailSnapshot(),learner=f.savedFamily.children[0].learnerId;
 expect((await (await f.getEnrollment('learnerId='+learner,f.parentToken)).json()).data.stages).toEqual([]);
 const fit=await f.fitCommand(),fits=await Promise.all(Array.from({length:4},()=>f.postEnrollment(fit)));expect(fits.map(r=>r.status)).toEqual([200,200,200,200]);const savedFits=await Promise.all(fits.map(r=>r.json()));expect(savedFits.filter(r=>!r.data.replayed)).toHaveLength(1);
 const read=await f.getEnrollment('learnerId='+learner,f.parentToken);expect(read.status).toBe(200);const content=await read.json();expect(content.data.stages).toHaveLength(1);expect(content.data.stages[0]).toMatchObject({stageId:f.ref.stageId,fit:{decision:'approved'},terms:{state:'available',body:document,sourceSha256:f.termsHash,acceptanceId:null}});expect(JSON.stringify(content)).not.toContain('PRIVATE_FIT_REVIEW');
 const terms=f.termsCommand(),responses=await Promise.all(Array.from({length:4},()=>f.postEnrollment(terms,f.parentToken)));expect(responses.map(r=>r.status)).toEqual([200,200,200,200]);const saved=await Promise.all(responses.map(r=>r.json()));expect(saved.filter(r=>!r.data.replayed)).toHaveLength(1);
 const rows=(await f.pool.query('SELECT id,parent_id,learner_id,source_sha256 FROM ls_fishing_stage.terms_acceptances WHERE workspace_id=$1',[f.workspaceId])).rows;expect(rows).toEqual([{id:terms.operationId,parent_id:f.parent.id,learner_id:learner,source_sha256:f.termsHash}]);
 const reread=(await (await f.getEnrollment('learnerId='+learner,f.parentToken)).json()).data;expect(reread.stages[0].terms.acceptanceId).toBe(terms.operationId);expect((await f.postEnrollment({...fit,note:'changed'})).status).toBe(409);expect((await f.postEnrollment({...terms,termsVersion:'changed'},f.parentToken)).status).toBe(409);expect((await f.postEnrollment({...terms,operationId:randomUUID()},f.parentToken)).status).toBe(409);
 expect(await f.protectedState()).toEqual(before);expect(await f.mailSnapshot()).toEqual(mailBefore);expect((await f.pool.query("SELECT count(*)::int AS count FROM ls_fishing_stage.fit_decisions WHERE workspace_id=$1",[f.workspaceId])).rows[0].count).toBe(1);
});
test('owner/parent role isolation, CSRF, source bindings, complete guardian authority and current fit are required before writes and cached results',async()=>{
 const f=await fixture(),fit=await f.fitCommand(),terms=f.termsCommand(),other=await f.family();
 expect((await f.postEnrollment(terms)).status).toBe(403);expect((await f.postEnrollment(fit,f.parentToken)).status).toBe(403);expect((await f.getEnrollment('applicationId='+f.id,f.parentToken)).status).toBe(400);
 expect((await f.getEnrollment('learnerId='+other.learnerId,f.parentToken)).status).toBe(404);const otherToken=await f.passwordLogin(other.parent.id+'@example.invalid');expect((await f.getEnrollment('learnerId='+terms.learnerId,otherToken)).status).toBe(404);
 expect((await f.postEnrollment(fit,f.token,{origin:'https://untrusted.invalid'})).status).toBe(403);expect((await f.postEnrollment(fit,f.token,{'x-csrf-token':'bad'})).status).toBe(403);expect((await f.postEnrollment(fit,f.token,{'idempotency-key':randomUUID()})).status).toBe(400);
 expect((await f.postEnrollment({...fit,binding:{...fit.binding,expectedFieldsDigest:'0'.repeat(64)}})).status).toBe(409);expect((await f.postEnrollment({...fit,binding:{...fit.binding,expectedFamilyDigest:'0'.repeat(64)}})).status).toBe(409);expect((await f.postEnrollment(terms,f.parentToken)).status).toBe(404);
 expect((await f.postEnrollment(fit)).status).toBe(200);expect((await f.postEnrollment(terms,f.parentToken)).status).toBe(200);
 const preview=await f.leads.preview(f.owner,{action:'preview_remove',operationId:randomUUID(),expectedEpoch:3,personId:fit.binding.personId,expectedAssociationVersion:1});if(preview.state!=='ready')throw Error('PREVIEW_REQUIRED');await f.leads.confirm(f.owner,{action:'confirm',token:preview.token,confirmNewPerson:false});expect((await f.postEnrollment(fit)).status).toBe(409);expect((await f.getEnrollment('learnerId='+terms.learnerId,f.parentToken)).status).toBe(200); // Lead removal does not delete family history/authority.
 await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2',[f.workspaceId,terms.learnerId]);expect((await f.postEnrollment(terms,f.parentToken)).status).toBe(404);
 await f.auth.logout(f.parent,randomUUID());expect((await f.postEnrollment(terms,f.parentToken)).status).toBe(401);expect((await f.pool.query('SELECT id FROM ls_fishing_stage.terms_acceptances WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(1);
});
test('metadata-only historical terms cannot be displayed as an accepted document through the new HTTP path',async()=>{
 const f=await fixture(null),fit=await f.fitCommand();expect((await f.postEnrollment(fit)).status).toBe(200);const context=(await (await f.getEnrollment('learnerId='+f.savedFamily.children[0].learnerId,f.parentToken)).json()).data;expect(context.stages[0].terms).toEqual({state:'unavailable'});expect((await f.postEnrollment(f.termsCommand(),f.parentToken)).status).toBe(409);expect((await f.pool.query('SELECT id FROM ls_fishing_stage.terms_acceptances WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(0);
});
test('a newer rejected fit hides parent terms and denies even a cached acceptance without erasing history',async()=>{
 const f=await fixture(),fit=await f.fitCommand(),terms=f.termsCommand();expect((await f.postEnrollment(fit)).status).toBe(200);expect((await f.postEnrollment(terms,f.parentToken)).status).toBe(200);
 expect((await f.postEnrollment({...fit,operationId:randomUUID(),decision:'rejected',note:'PRIVATE_CURRENT_FIT_REJECTION'})).status).toBe(200);const read=await f.getEnrollment('learnerId='+terms.learnerId,f.parentToken);expect(read.status).toBe(200);expect((await read.json()).data.stages).toEqual([]);expect((await f.postEnrollment(terms,f.parentToken)).status).toBe(404);expect((await f.pool.query('SELECT id FROM ls_fishing_stage.terms_acceptances WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(1);
});
test('actual source document bytes must match the imported approval hash before any new review or acceptance',async()=>{
 const f=await fixture(document,'0'.repeat(64)),response=await f.getEnrollment('applicationId='+f.id);expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain(document);expect((await f.pool.query('SELECT id FROM ls_fishing_stage.terms_acceptances WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(0);
});
