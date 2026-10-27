import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({imports:0,identity:vi.fn(),transport:vi.fn(),close:vi.fn(),construct:vi.fn(),tick:vi.fn(),drain:vi.fn(),single:vi.fn(),legacy:vi.fn(),legacyCallback:vi.fn(),signupCallback:vi.fn(),http:vi.fn(),query:vi.fn(),supervise:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../src/features/identity/runtime.ts',()=>{m.imports++;return {identityRuntime:m.identity};});
vi.mock('../../src/db/client.ts',()=>({closeDatabase:m.close}));
vi.mock('../../src/features/group-application/inquiry-email.ts',()=>{m.imports++;return {createInquiryEmailTransport:m.transport,inquiryEmailQueueEnabled:(env:Record<string,string|undefined>)=>env.LS_INQUIRY_EMAIL_QUEUE_ENABLED==='true',InquiryEmailOutbox:class{dispatchOne=m.legacy;dispatchForApplication=m.legacyCallback;}};});
vi.mock('../../src/features/group-application/academy-founder-store.ts',()=>({AcademyFounderStore:class{constructor(...args:unknown[]){m.construct(...args);}tick=m.tick;dispatchQueued=m.drain;dispatchOne=m.single;dispatchForApplication=m.signupCallback;}}));
vi.mock('../../scripts/signup-worker-supervisor.ts',()=>({superviseSignupWorker:m.supervise}));
vi.mock('../../src/features/group-application/http.ts',()=>({publicGroupApplicationHttp:m.http}));
vi.mock('../../src/features/group-application/candidate.ts',()=>({publicGroupApplicationEnabled:()=>true}));
vi.mock('../../src/features/group-application/store.ts',()=>({PublicGroupApplicationStore:class{}}));
// Ordinary unit config intentionally has no production @ alias. Explicit
// virtual mocks keep route testing isolated without changing CI or app config.
vi.mock('@/features/group-application/academy-signup-population-runtime.ts',()=>import('../../src/features/group-application/academy-signup-population-runtime.ts'));
vi.mock('@/features/identity/runtime.ts',()=>({identityRuntime:m.identity}));
vi.mock('@/features/group-application/candidate.ts',()=>({publicGroupApplicationEnabled:()=>true}));
vi.mock('@/features/group-application/http.ts',()=>({publicGroupApplicationHttp:m.http}));
vi.mock('@/features/group-application/store.ts',()=>({PublicGroupApplicationStore:class{}}));
vi.mock('@/features/group-application/inquiry-email.ts',()=>({createInquiryEmailTransport:m.transport,inquiryEmailQueueEnabled:(env:Record<string,string|undefined>)=>env.LS_INQUIRY_EMAIL_QUEUE_ENABLED==='true',InquiryEmailOutbox:class{dispatchOne=m.legacy;dispatchForApplication=m.legacyCallback;}}));
vi.mock('@/features/group-application/academy-founder-store.ts',()=>({AcademyFounderStore:class{constructor(...args:unknown[]){m.construct(...args);}tick=m.tick;dispatchQueued=m.drain;dispatchOne=m.single;dispatchForApplication=m.signupCallback;}}));
const workspace='11111111-1111-4111-8111-111111111111',origin='https://bneineviimacademy.org',sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const bindings=()=>({templateModuleSha256:sha('src/features/group-application/academy-founder-email.ts'),templateContractSha256:sha('src/features/group-application/academy-founder-contract.ts'),templateCatalogSha256:sha('src/features/group-application/academy-exact-email-copy.json'),templateFacadeSha256:sha('src/features/group-application/academy-exact-copy.ts'),transportHashes:{gmail:sha('src/providers/email/gmail.ts'),contract:sha('src/providers/email/transport.ts'),resend:sha('src/providers/email/resend.ts')}});
const policy={version:'JLFA-SIGNUP-WORKER-ADMISSION-v2',approvalReceiptSha256:'d'.repeat(64),sourceCommit:'a'.repeat(40),workspaceId:workspace,projectId:'22222222-2222-4222-8222-222222222222',environmentId:'33333333-3333-4333-8333-333333333333',serviceId:'44444444-4444-4444-8444-444444444444',origin,sender:'office@bneineviimacademy.org',...bindings(),templateVersion:'JLFA-EXACT-COPY-20261026-05',allowedTemplateIds:['R01','R02','R03'],cutoff:'2026-10-25T11:00:00.000Z',expiresAt:'2026-10-26T11:00:00.000Z',population:{mode:'future_submissions'}};

beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();m.imports=0;vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
 vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--drain-due']);vi.spyOn(console,'log').mockImplementation(()=>{});
 vi.spyOn(process,'on').mockReturnValue(process);vi.spyOn(process,'off').mockReturnValue(process);
 for(const [k,v] of Object.entries({LS_ACADEMY_SIGNUP_WORKER_ENABLED:'true',LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:JSON.stringify(policy),LS_INQUIRY_EMAIL_QUEUE_ENABLED:'true',LS_ACADEMY_FREE_REGISTRATION_ENABLED:'true',LS_INQUIRY_EMAIL_SEND_ENABLED:'true',LS_ACADEMY_FOUNDER_EMAIL_APPROVED:'true',LS_ACADEMY_PAYMENT_EMAIL_APPROVED:'true',RAILWAY_GIT_COMMIT_SHA:policy.sourceCommit,LIFE_SKILLS_RELEASE_COMMIT:policy.sourceCommit,LS_IDENTITY_WORKSPACE_ID:workspace,RAILWAY_PROJECT_ID:policy.projectId,RAILWAY_ENVIRONMENT_ID:policy.environmentId,RAILWAY_SERVICE_ID:policy.serviceId,LS_APP_ORIGIN:origin}))vi.stubEnv(k,v);
 vi.stubEnv('LS_ACADEMY_FOUNDER_REMINDER_DAYS',undefined);vi.stubEnv('LS_ACADEMY_PAYMENT_REMINDER_HOUR',undefined);
 m.identity.mockResolvedValue({services:{limits:{}},store:{transaction:async(fn:(tx:{query:typeof m.query})=>unknown)=>fn({query:m.query})},config:{workspaceId:workspace,keyring:{},lookupKey:Buffer.alloc(32,1),origin},clock:{now:()=>new Date()}});m.transport.mockReturnValue({transport:{synthetic:true},from:policy.sender});m.drain.mockResolvedValue({processed:0,inspected:0,scanComplete:true,continuation:undefined});m.http.mockImplementation(async(_request:Request,load:()=>Promise<{afterCommit:(id:string)=>Promise<unknown>}>)=>{const deps=await load();await deps.afterCommit('55555555-5555-4555-8555-555555555555');return new Response('synthetic');});m.query.mockResolvedValue([{founderId:'synthetic-family'}]);m.single.mockResolvedValue('idle');m.supervise.mockImplementation(async(options:{cycle:()=>Promise<void>})=>options.cycle());
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.useRealTimers();});
it.each(['missing','disabled','wrong-source','wrong-template','wrong-catalog','wrong-transport','R00'] as const)('CLI closes %s before effect runtime imports',async(mode)=>{
 if(mode==='missing')vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',undefined);
 if(mode==='disabled')vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ENABLED','false');
 if(mode==='wrong-source')vi.stubEnv('LIFE_SKILLS_RELEASE_COMMIT','f'.repeat(40));
 const delta=mode==='wrong-template'?{templateModuleSha256:'e'.repeat(64)}:mode==='wrong-catalog'?{templateCatalogSha256:'e'.repeat(64)}:mode==='wrong-transport'?{transportHashes:{...policy.transportHashes,gmail:'e'.repeat(64)}}:mode==='R00'?{allowedTemplateIds:['R00']}:null;
 if(delta)vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',JSON.stringify({...policy,...delta}));
 await import('../../scripts/inquiry-email-worker.ts');expect(m.imports).toBe(0);expect(m.identity).not.toHaveBeenCalled();expect(m.transport).not.toHaveBeenCalled();expect(m.tick).not.toHaveBeenCalled();expect(m.drain).not.toHaveBeenCalled();expect(m.close).not.toHaveBeenCalled();expect(console.log).toHaveBeenCalledWith('{"state":"SEND_DISABLED","processed":0}');
});
it('forces signup and passes one current issued population to store, tick and drain',async()=>{
 await import('../../scripts/inquiry-email-worker.ts');expect(m.tick).toHaveBeenCalledTimes(1);expect(m.drain).toHaveBeenCalledTimes(1);
 const a=m.tick.mock.calls[0]?.[3];expect(a).toMatchObject({cutoff:policy.cutoff,templateVersion:policy.templateVersion,allowedTemplateIds:['R01','R02','R03']});expect(m.construct.mock.calls[0]?.[7]).toBe(a);expect(m.tick.mock.calls[0]?.[2]).toBe('signup');expect(m.drain.mock.calls[0]?.[3]).toBe('signup');expect(m.drain.mock.calls[0]?.[4]).toBe(a);expect(m.close).toHaveBeenCalledTimes(1);
});
it('single dispatch requires founder row and the same population; no old inquiry fallback',async()=>{
 vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--dispatch-signup-one','55555555-5555-4555-8555-555555555555']);m.query.mockResolvedValue([{founderId:null}]);
 await expect(import('../../scripts/inquiry-email-worker.ts')).rejects.toThrow('SIGNUP_MESSAGE_NOT_FOUND');expect(m.single).not.toHaveBeenCalled();expect(m.close).toHaveBeenCalledTimes(1);
});
it('generic one-message dispatch preserves the unrelated non-founder inquiry path without signup policy',async()=>{
 vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--dispatch-one','55555555-5555-4555-8555-555555555555']);vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',undefined);m.query.mockResolvedValue([{founderId:null}]);m.legacy.mockResolvedValue('sent');
 await import('../../scripts/inquiry-email-worker.ts');expect(m.legacy).toHaveBeenCalledTimes(1);expect(m.single).not.toHaveBeenCalled();expect(m.tick).not.toHaveBeenCalled();expect(m.close).toHaveBeenCalledTimes(1);
});
it('generic CLI spelling cannot bypass v2 for a founder row',async()=>{
 vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--dispatch-one','55555555-5555-4555-8555-555555555555']);vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',undefined);
 await expect(import('../../scripts/inquiry-email-worker.ts')).rejects.toThrow('SIGNUP_WORKER_NOT_ADMITTED');expect(m.transport).not.toHaveBeenCalled();expect(m.single).not.toHaveBeenCalled();expect(m.legacy).not.toHaveBeenCalled();expect(m.close).toHaveBeenCalledTimes(1);
});
it('both single-message spellings pass the same current signup policy for founder rows',async()=>{
 vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--dispatch-one','55555555-5555-4555-8555-555555555555']);await import('../../scripts/inquiry-email-worker.ts');expect(m.single).toHaveBeenCalledTimes(1);expect(m.single.mock.calls[0]?.[4]).toBe('signup');expect(m.single.mock.calls[0]?.[5]).toBe(m.construct.mock.calls[0]?.[7]);expect(m.legacy).not.toHaveBeenCalled();
});
it('hosted mode is not installed by import; explicit flag invokes injected supervisor and closes owned runtime',async()=>{
 vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--hosted-signup']);await import('../../scripts/inquiry-email-worker.ts');expect(m.supervise).toHaveBeenCalledTimes(1);expect(m.drain).toHaveBeenCalledTimes(1);expect(process.on).toHaveBeenCalledWith('SIGTERM',expect.any(Function));expect(process.off).toHaveBeenCalledWith('SIGTERM',expect.any(Function));expect(m.close).toHaveBeenCalledTimes(1);
});
it('enabled hosted mode with missing admission fails before imports',async()=>{
 vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--hosted-signup']);vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',undefined);await expect(import('../../scripts/inquiry-email-worker.ts')).rejects.toThrow('SIGNUP_WORKER_NOT_ADMITTED');expect(m.imports).toBe(0);
});
it('policy expiry while runtime initializes prevents transport construction and due work',async()=>{
 m.identity.mockImplementation(async()=>{vi.setSystemTime(new Date(policy.expiresAt));return {store:{},config:{workspaceId:workspace,origin},clock:{now:()=>new Date()}};});await expect(import('../../scripts/inquiry-email-worker.ts')).rejects.toThrow('SIGNUP_WORKER_NOT_ADMITTED');expect(m.transport).not.toHaveBeenCalled();expect(m.tick).not.toHaveBeenCalled();expect(m.close).toHaveBeenCalledTimes(1);
});

it('hosted cycles advance the advisory cursor past held pages and reset only at the observed end',async()=>{
 const cursor={createdAt:'2026-10-25 12:00:00.123456+00',id:'55555555-5555-4555-8555-555555555555'};
 m.drain.mockResolvedValueOnce({processed:0,inspected:50,scanComplete:false,continuation:cursor}).mockResolvedValueOnce({processed:1,inspected:6,scanComplete:true,continuation:undefined});
 m.supervise.mockImplementation(async(options:{cycle:()=>Promise<void>})=>{await options.cycle();await options.cycle();await options.cycle();});
 vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--hosted-signup']);await import('../../scripts/inquiry-email-worker.ts');
 expect(m.drain.mock.calls.map(c=>c[5])).toEqual([undefined,cursor,undefined]);expect(m.construct).toHaveBeenCalledTimes(3);
});
it('a changed admitted population resets the old cursor rather than skipping its new scope',async()=>{
 const cursor={createdAt:'2026-10-25 12:00:00.123456+00',id:'55555555-5555-4555-8555-555555555555'};
 m.drain.mockResolvedValueOnce({processed:0,inspected:50,scanComplete:false,continuation:cursor});
 m.supervise.mockImplementation(async(options:{cycle:()=>Promise<void>})=>{await options.cycle();vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',JSON.stringify({...policy,cutoff:'2026-10-25T11:30:00.000Z'}));await options.cycle();});
 vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--hosted-signup']);await import('../../scripts/inquiry-email-worker.ts');
 expect(m.drain.mock.calls.map(c=>c[5])).toEqual([undefined,undefined]);expect(m.tick.mock.calls[1]?.[3].cutoff).toBe('2026-10-25T11:30:00.000Z');
});
it('one-shot drain reports only its bounded page without logging the cursor or claiming a completed drain',async()=>{
 m.drain.mockResolvedValue({processed:0,inspected:50,scanComplete:false,continuation:{createdAt:'2026-10-25 12:00:00+00',id:'55555555-5555-4555-8555-555555555555'}});
 await import('../../scripts/inquiry-email-worker.ts');expect(console.log).toHaveBeenCalledWith('{"state":"SIGNUP_QUEUE_PAGE","processed":0,"inspected":50,"scanComplete":false}');expect(m.drain).toHaveBeenCalledTimes(1);
});
it.each(['missing-signup','no-founder'] as const)('public afterCommit preserves the generic inquiry acknowledgment with %s',async(mode)=>{
 vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',undefined);if(mode==='no-founder')vi.stubEnv('LS_ACADEMY_FREE_REGISTRATION_ENABLED','false');m.legacyCallback.mockResolvedValue('sent');
 const route=await import('../../src/app/api/public/group-applications/route.ts');await route.POST(new Request(origin+'/api/public/group-applications',{method:'POST'}));
 expect(m.legacyCallback).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555',{synthetic:true},policy.sender);expect(m.transport).toHaveBeenCalledTimes(1);expect(m.single).not.toHaveBeenCalled();
});
it.each(['QUEUE','SEND'] as const)('public generic callback retains the original %s-off gate',async(flag)=>{
 vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',undefined);vi.stubEnv(flag==='QUEUE'?'LS_INQUIRY_EMAIL_QUEUE_ENABLED':'LS_INQUIRY_EMAIL_SEND_ENABLED','false');
 const route=await import('../../src/app/api/public/group-applications/route.ts');await route.POST(new Request(origin+'/api/public/group-applications',{method:'POST'}));
 expect(m.transport).not.toHaveBeenCalled();expect(m.legacyCallback).not.toHaveBeenCalled();
});
it('the unchanged generic HTTP dispatcher selects only its existing inquiry purpose',()=>{
 const source=readFileSync('src/features/group-application/inquiry-email.ts','utf8'),start=source.indexOf(' async dispatchForApplication('),end=source.indexOf(' async dispatchOne(',start),method=source.slice(start,end);
 expect(method).toContain('application_id=$2 AND purpose=$3');expect(method).toContain('[this.workspace,reference,INQUIRY_EMAIL_PURPOSE]');expect(method).not.toContain('academy_founder_');
});

function controlledPolicy(){return {...policy,expiresAt:'2026-10-25T13:00:00.000Z',allowedTemplateIds:['R00','R03'],r00Exception:{version:'JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01',approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'},population:{mode:'controlled_test',admittedAt:'2026-10-25T12:00:00.000Z',recipientSha256:'9'.repeat(64),learnerIds:['66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777']}};}
function setControlled(){vi.stubEnv('LS_ACADEMY_FOUNDER_EMAIL_APPROVED',undefined);vi.stubEnv('LS_INQUIRY_EMAIL_SEND_ENABLED','false');vi.stubEnv('LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED','true');vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',JSON.stringify(controlledPolicy()));}
it('controlled signup CLI passes issued policy to factory while global send and generic CLI stay closed',async()=>{
 setControlled();vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--dispatch-signup-one','55555555-5555-4555-8555-555555555555']);
 await import('../../scripts/inquiry-email-worker.ts');expect(m.single).toHaveBeenCalledTimes(1);expect(m.transport.mock.calls[0]?.[2].policy).toBe(m.construct.mock.calls[0]?.[7]);expect(m.legacy).not.toHaveBeenCalled();
 vi.resetModules();vi.clearAllMocks();vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--dispatch-one','55555555-5555-4555-8555-555555555555']);await import('../../scripts/inquiry-email-worker.ts');expect(m.identity).not.toHaveBeenCalled();expect(m.transport).not.toHaveBeenCalled();
});
it.each(['missing-dedicated','global-on','broad-population'] as const)('controlled loader rejects %s before runtime or transport',async(mode)=>{
 setControlled();if(mode==='missing-dedicated')vi.stubEnv('LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED',undefined);if(mode==='global-on')vi.stubEnv('LS_INQUIRY_EMAIL_SEND_ENABLED','true');if(mode==='broad-population')vi.stubEnv('LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON',JSON.stringify(policy));
 await import('../../scripts/inquiry-email-worker.ts');expect(m.identity).not.toHaveBeenCalled();expect(m.transport).not.toHaveBeenCalled();expect(m.drain).not.toHaveBeenCalled();
});
it('global-off generic public HTTP callback stays inert even with an admitted test policy',async()=>{
 setControlled();const route=await import('../../src/app/api/public/group-applications/route.ts');await route.POST(new Request(origin+'/api/public/group-applications',{method:'POST'}));
 expect(m.legacyCallback).not.toHaveBeenCalled();expect(m.transport).toHaveBeenCalledTimes(1);expect(m.signupCallback).toHaveBeenCalledTimes(1);expect(m.transport.mock.calls[0]?.[2].policy.population.mode).toBe('controlled_test');
});
it('controlled hosted expiry closes owned DB and reports a planned stop without another effect cycle',async()=>{
 setControlled();vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--hosted-signup']);
 const prior=process.send,send=vi.fn();process.send=send as NonNullable<typeof process.send>;
 try{m.supervise.mockImplementation(async(options:{cycle:()=>Promise<void>;signal:AbortSignal})=>{await options.cycle();vi.setSystemTime(new Date(controlledPolicy().expiresAt));await options.cycle();expect(options.signal.aborted).toBe(true);});
  await import('../../scripts/inquiry-email-worker.ts');expect(m.drain).toHaveBeenCalledTimes(1);expect(m.transport).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledWith({type:'JLFA_SIGNUP_WORKER_COMPLETE',reason:'ADMISSION_EXPIRED'});expect(m.close).toHaveBeenCalledTimes(1);
 }finally{if(prior)process.send=prior;else delete process.send;}
});
it('already expired controlled worker imports no DB/provider and returns a planned closed state',async()=>{
 setControlled();vi.setSystemTime(new Date(controlledPolicy().expiresAt));vi.spyOn(process,'argv','get').mockReturnValue(['node','synthetic-worker','--hosted-signup']);
 await import('../../scripts/inquiry-email-worker.ts');expect(m.identity).not.toHaveBeenCalled();expect(m.transport).not.toHaveBeenCalled();expect(console.log).toHaveBeenCalledWith('{"state":"CONTROLLED_ADMISSION_EXPIRED"}');
});
