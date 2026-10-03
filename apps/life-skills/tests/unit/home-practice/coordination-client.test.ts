import {afterEach,expect,test,vi} from 'vitest';
import {coordinationCommand,coordinationDefaults,coordinationFrameKey,coordinationRefreshDelay,coordinationReadback,prepareCoordinationSave,readCoordination,saveCoordination} from '../../../src/features/home-practice/coordination-client.ts';
import {coordinationAssignees} from '../../../src/features/home-practice/policy.ts';
import {asId} from '../../../src/lib/ids.ts';
import type {AccountFacts} from '../../../src/features/identity/types.ts';
import type {PracticeCoordinationPage} from '../../../src/features/home-practice/types.ts';
const account=asId('123e4567-e89b-12d3-a456-426614174000','account'),other=asId('123e4567-e89b-12d3-a456-426614174001','account'),workspace=asId('123e4567-e89b-12d3-a456-426614174002','workspace'),person=asId('123e4567-e89b-12d3-a456-426614174003','person'),caseId=asId('123e4567-e89b-12d3-a456-426614174004','case'),audienceId=asId('123e4567-e89b-12d3-a456-426614174005','audience'),assignment=asId('123e4567-e89b-12d3-a456-426614174006','practice_assignment'),version=asId('123e4567-e89b-12d3-a456-426614174007','coordination_version');
const actor:AccountFacts={id:account,workspaceId:workspace,personId:person,role:'adult_client',state:'active',locale:'en'};
const item={id:caseId,workspaceId:workspace,clientPersonId:person,practitionerAccountId:other,kind:'adult' as const,state:'active' as const};
const audience={id:audienceId,workspaceId:workspace,caseId,visibility:'family_full' as const,published:true,accountIds:[account,other]};
const page:PracticeCoordinationPage={ownAccountId:account,role:'adult_client',eligibleAccountIds:[account],asOf:'2026-10-01T12:00:00Z',currentVersion:null,nextEffectiveFrom:null,hasMore:false,versions:[]};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
test('native child responsibility reads real assisted actors and separate reminder routing without granting parent coordination',async()=>{
 const source=asId('123e4567-e89b-12d3-a456-426614174008','practice_version'),third=asId('123e4567-e89b-12d3-a456-426614174009','account');
 const row={versionId:version,assignmentId:assignment,caseId,audienceId,assigneeAccountIds:[],assistedParentAccountIds:[account],responsibilityVersionId:source,participant:'client' as const,completionMode:'any_assignee' as const,reminderCandidateAccountIds:[account,other,third],effectiveFrom:'2026-10-02T18:45:00.000Z',changedByAccountId:other};
 const readOnly:PracticeCoordinationPage={...page,role:'parent',readOnlyReason:'client_responsibility',eligibleAccountIds:[],versions:[row]};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:true,data:readOnly})));expect(await readCoordination(assignment,caseId,audienceId)).toEqual(readOnly);
 for(const malformed of [{...readOnly,readOnlyReason:'unknown'},{...readOnly,eligibleAccountIds:[account]},{...readOnly,role:'adult_client'},{...readOnly,versions:[{...row,reminderCandidateAccountIds:[account,other,third,workspace]}]},{...readOnly,versions:[{...row,assistedParentAccountIds:[]}]},{...readOnly,versions:[{...row,responsibilityVersionId:null}]},{...readOnly,versions:[{...row,participant:'parent'}]},{...readOnly,versions:[{...row,completionMode:'each_assignee'}]}]){
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:true,data:malformed})));await expect(readCoordination(assignment,caseId,audienceId)).rejects.toThrow('UNAVAILABLE');
 }
});
test('preparation reads fresh server time after a slow ordinary session lookup, never the browser clock',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(Date.parse('2040-01-01T00:00:00Z'));
 const latest={...page,asOf:'2026-10-01T12:05:00Z'},fetcher=vi.fn(async(path:string,_init?:RequestInit)=>{void _init;return Response.json({ok:true,data:path==='/api/identity/session'?{accountId:account,role:'adult_client',csrfToken:'synthetic-csrf'}:path.includes('view=coordination')?latest:{versionId:version}});});vi.stubGlobal('fetch',fetcher);
 const prepared=await prepareCoordinationSave(assignment,caseId,audienceId,account,'adult_client');
 const command=coordinationCommand(assignment,[account],'any_assignee',[],Date.parse(prepared.page.asOf),prepared.page.currentVersion?.versionId??null);
 expect(command.effectiveFrom).toBe('2026-10-01T12:06:00.000Z');expect(command.expectedCurrentVersionId).toBeNull();
 expect(await prepared.submit(command)).toEqual({versionId:version});
 expect(fetcher.mock.calls.map(([path])=>path.split('?')[0])).toEqual(['/api/identity/session','/api/home-practice','/api/home-practice']);
 expect(fetcher.mock.calls[2]?.[1]).toMatchObject({method:'POST',headers:{'X-CSRF-Token':'synthetic-csrf'},body:JSON.stringify(command)});
 vi.restoreAllMocks();
});
test('preparation refuses a changed ordinary identity before any read or write',async()=>{
 const fetcher=vi.fn(async()=>Response.json({ok:true,data:{accountId:other,role:'parent',csrfToken:'synthetic-csrf'}}));vi.stubGlobal('fetch',fetcher);
 await expect(prepareCoordinationSave(assignment,caseId,audienceId,account,'adult_client')).rejects.toThrow('NOT_FOUND');expect(fetcher).toHaveBeenCalledTimes(1);
});
test('effective-frame comparison ignores clock/history churn but detects changed responsibility, access and read-only state',()=>{
 const current={versionId:version,assignmentId:assignment,caseId,audienceId,assigneeAccountIds:[account],completionMode:'any_assignee' as const,reminderCandidateAccountIds:[],effectiveFrom:'2026-10-01T11:00:00Z',changedByAccountId:account};
 expect(coordinationFrameKey({...page,asOf:'2026-10-01T12:01:00Z',hasMore:true})).toBe(coordinationFrameKey(page));
 for(const changed of [{...page,currentVersion:current},{...page,eligibleAccountIds:[]},{...page,role:'parent' as const,eligibleAccountIds:[],readOnlyReason:'legacy_child_assignment' as const}])expect(coordinationFrameKey(changed)).not.toBe(coordinationFrameKey(page));
});
test('pending refresh is relative to the server frame and monotonic elapsed time, with no wall-clock dependency',()=>{
 const future={versionId:version,assignmentId:assignment,caseId,audienceId,assigneeAccountIds:[account],completionMode:'any_assignee' as const,reminderCandidateAccountIds:[],effectiveFrom:'2026-10-01T12:01:00Z',changedByAccountId:account};
 expect(coordinationRefreshDelay({...page,nextEffectiveFrom:future.effectiveFrom,versions:[future]},10_000)).toBe(50_100);expect(coordinationRefreshDelay({...page,nextEffectiveFrom:future.effectiveFrom,versions:[future]},70_000)).toBe(100);expect(coordinationRefreshDelay(page,0)).toBeNull();
});
test('pending refresh uses the earliest effective boundary outside the twenty-row history',()=>{
 const future={versionId:version,assignmentId:assignment,caseId,audienceId,assigneeAccountIds:[account],completionMode:'any_assignee' as const,reminderCandidateAccountIds:[],effectiveFrom:'2026-10-04T12:00:00Z',changedByAccountId:account};
 const bounded={...page,nextEffectiveFrom:'2026-10-01T12:01:00Z',hasMore:true,versions:Array.from({length:20},()=>future)};
 expect(coordinationRefreshDelay(bounded,10_000)).toBe(50_100);
 expect(coordinationRefreshDelay(bounded,70_000)).toBe(100);
});
test('read-only legacy child responsibility is preserved, not filtered into a parent-only edit',async()=>{
 const current={versionId:version,assignmentId:assignment,caseId,audienceId,assigneeAccountIds:[account,other],completionMode:'each_assignee' as const,reminderCandidateAccountIds:[other],effectiveFrom:'2026-10-01T11:00:00Z',changedByAccountId:account};
 const value={...page,role:'parent' as const,eligibleAccountIds:[],readOnlyReason:'legacy_child_assignment' as const,currentVersion:current,versions:[current]};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:true,data:value})));expect(await readCoordination(assignment,caseId,audienceId)).toEqual(value);
 expect(coordinationDefaults(value)).toEqual({assignees:[account,other],reminders:[other],mode:'each_assignee'});
});
test('coordination policy allows only an active exact-subject adult self-assignment in the published audience',()=>{
 expect(coordinationAssignees(actor,item,[],audience,[account],[account])).toEqual([account]);
 for(const args of [
  [{...actor,role:'child'},item,audience,[account]],
  [actor,{...item,kind:'minor'},audience,[account]],
  [{...actor,personId:asId('123e4567-e89b-12d3-a456-426614174099','person')},item,audience,[account]],
  [actor,item,{...audience,published:false},[account]],
  [actor,item,{...audience,visibility:'private'},[account]],
  [actor,item,audience,[other]],
  [actor,item,audience,[account,other]],
  [{...actor,state:'revoked'},item,audience,[account]],
 ] as const)expect(()=>coordinationAssignees(args[0] as AccountFacts,args[1],[],args[2] as typeof audience,args[3],[account,other])).toThrow('NOT_FOUND');
});
test('coordination freezes one prospective request and validates distinct assignees/reminder routing',()=>{
 const command=coordinationCommand(assignment,[account],'any_assignee',[account],Date.parse('2026-10-01T12:00:00Z'));
 expect(command.effectiveFrom).toBe('2026-10-01T12:01:00.000Z');expect(Object.isFrozen(command)).toBe(true);expect(Object.isFrozen(command.assigneeAccountIds)).toBe(true);
 for(const fn of [()=>coordinationCommand(assignment,[],'any_assignee',[],0),()=>coordinationCommand(assignment,[account,account],'any_assignee',[],0),()=>coordinationCommand(assignment,[account],'each_assignee',[],0),()=>coordinationCommand(assignment,[account],'any_assignee',[other],0)])expect(fn).toThrow('INVALID_REQUEST');
});
test('readback binds the exact writer, version, future time, completion mode and routing',()=>{
 const command=coordinationCommand(assignment,[account],'any_assignee',[account],0),row={versionId:version,assignmentId:assignment,caseId,audienceId,assigneeAccountIds:[account],completionMode:'any_assignee' as const,reminderCandidateAccountIds:[account],effectiveFrom:command.effectiveFrom,changedByAccountId:account};
 expect(coordinationReadback(command,{...page,versions:[row]},version)).toEqual(row);
 for(const changed of [{changedByAccountId:other},{versionId:asId('123e4567-e89b-12d3-a456-426614174098','coordination_version')},{reminderCandidateAccountIds:[]},{effectiveFrom:'2026-10-01T00:00:00Z'},{assigneeAccountIds:[other]},{completionMode:'each_assignee' as const}])expect(coordinationReadback(command,{...page,versions:[{...row,...changed}]},version)).toBeNull();
 expect(coordinationReadback(command,{...page,versions:[row]})).toEqual(row);
});
test('read bridge validates case/assignment envelopes and keeps abort/no-store same-origin policy',async()=>{
 const fetcher=vi.fn(async(_path:string,_init?:RequestInit)=>{void _path;void _init;return Response.json({ok:true,data:page});});vi.stubGlobal('fetch',fetcher);
 expect(await readCoordination(assignment,caseId,audienceId)).toEqual(page);expect(fetcher.mock.calls[0]?.[0]).toContain('view=coordination');
 expect(fetcher.mock.calls[0]?.[1]).toMatchObject({credentials:'same-origin',cache:'no-store',redirect:'error'});
 for(const malformed of [{...page,eligibleAccountIds:[other]},{...page,role:'child'},{...page,versions:[{assignmentId:'another',caseId,audienceId}]},{...page,versions:Array(21).fill({})}]){fetcher.mockImplementation(async()=>Response.json({ok:true,data:malformed}));await expect(readCoordination(assignment,caseId,audienceId)).rejects.toThrow('UNAVAILABLE');}
 fetcher.mockImplementation(async()=>Response.json({ok:false,error:{code:'UNAUTHENTICATED'}},{status:401}));await expect(readCoordination(assignment,caseId,audienceId)).rejects.toThrow('UNAUTHENTICATED');
});
test('mutation uses ordinary session CSRF and refuses mismatched role/account without posting',async()=>{
 const command=coordinationCommand(assignment,[account],'any_assignee',[],0),fetcher=vi.fn(async(path:string,_init?:RequestInit)=>{void _init;return Response.json({ok:true,data:path==='/api/identity/session'?{accountId:account,role:'adult_client',csrfToken:'synthetic-csrf'}:{versionId:version}});});vi.stubGlobal('fetch',fetcher);
 expect(await saveCoordination(command,account,'adult_client')).toEqual({versionId:version});expect(fetcher.mock.calls).toHaveLength(2);expect(fetcher.mock.calls[1]?.[1]).toMatchObject({method:'POST',headers:{'X-CSRF-Token':'synthetic-csrf'},body:JSON.stringify(command)});
 fetcher.mockClear();await expect(saveCoordination(command,other,'adult_client')).rejects.toThrow('NOT_FOUND');expect(fetcher.mock.calls).toHaveLength(1);
 fetcher.mockClear();await expect(saveCoordination(command,account,'parent')).rejects.toThrow('NOT_FOUND');expect(fetcher.mock.calls).toHaveLength(1);
});

test('coordination defaults use the effective selection outside history, not newest insertion or future changes',()=>{
 const row={versionId:version,assignmentId:assignment,caseId,audienceId,assigneeAccountIds:[account,other],completionMode:'each_assignee' as const,reminderCandidateAccountIds:[other],effectiveFrom:'2026-10-01T11:00:00Z',changedByAccountId:account};
 const future={...row,versionId:asId('123e4567-e89b-12d3-a456-426614174008','coordination_version'),assigneeAccountIds:[account],completionMode:'any_assignee' as const,reminderCandidateAccountIds:[],effectiveFrom:'2026-10-02T11:00:00Z'};
 const current={...page,role:'parent' as const,eligibleAccountIds:[account,other],currentVersion:row,versions:[future],hasMore:true};
 expect(coordinationDefaults(current)).toEqual({assignees:[account,other],reminders:[other],mode:'each_assignee'});
 expect(coordinationDefaults({...current,currentVersion:null})).toEqual({assignees:[account],reminders:[],mode:'any_assignee'});
 expect(coordinationDefaults({...current,eligibleAccountIds:[account]})).toEqual({assignees:[account],reminders:[],mode:'any_assignee'});
 expect(coordinationDefaults({...current,role:'adult_client',eligibleAccountIds:[account]})).toEqual({assignees:[account],reminders:[],mode:'any_assignee'});
});

test('read bridge validates the separate effective selection and server time without requiring it in bounded history',async()=>{
 const row={versionId:version,assignmentId:assignment,caseId,audienceId,assigneeAccountIds:[account],completionMode:'any_assignee' as const,reminderCandidateAccountIds:[],effectiveFrom:'2026-10-01T11:00:00Z',changedByAccountId:account},valid={...page,currentVersion:row,hasMore:true};
 const fetcher=vi.fn(async()=>Response.json({ok:true,data:valid}));vi.stubGlobal('fetch',fetcher);
 expect(await readCoordination(assignment,caseId,audienceId)).toEqual(valid);
 for(const invalid of [{...valid,asOf:undefined},{...valid,asOf:'not-time'},{...valid,currentVersion:undefined},{...valid,currentVersion:{...row,caseId:other}},{...valid,currentVersion:{...row,effectiveFrom:'2026-10-02T11:00:00Z'}},{...valid,nextEffectiveFrom:undefined},{...valid,nextEffectiveFrom:'not-time'},{...valid,nextEffectiveFrom:valid.asOf},{...valid,nextEffectiveFrom:'2026-10-01T11:59:59Z'}]){fetcher.mockImplementation(async()=>Response.json({ok:true,data:invalid}));await expect(readCoordination(assignment,caseId,audienceId)).rejects.toThrow('UNAVAILABLE');}
 fetcher.mockImplementation(async()=>Response.json({ok:true,data:{...valid,nextEffectiveFrom:'2026-10-01T12:01:00Z'}}));expect((await readCoordination(assignment,caseId,audienceId)).nextEffectiveFrom).toBe('2026-10-01T12:01:00Z');
});
