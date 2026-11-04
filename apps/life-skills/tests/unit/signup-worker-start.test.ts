import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {expect,it,vi} from 'vitest';
const moduleUrl=pathToFileURL(resolve('scripts/start.mjs')).href;
const {startApplication}=await import(/* @vite-ignore */ moduleUrl) as {startApplication:(options:Record<string,unknown>)=>{stop:()=>void}};
function fixture(enabled=false){
 const host=Object.assign(new EventEmitter(),{env:{PORT:'3010',...(enabled?{LS_ACADEMY_SIGNUP_WORKER_ENABLED:'true',LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:'synthetic-private-policy',LS_INQUIRY_EMAIL_QUEUE_ENABLED:'true',LS_INQUIRY_EMAIL_SEND_ENABLED:'true',LS_ACADEMY_FREE_REGISTRATION_ENABLED:'true',LS_ACADEMY_FOUNDER_EMAIL_APPROVED:'true'}:{})} as Record<string,string|undefined>,execPath:'/synthetic/node',exitCode:0});
 const children:(EventEmitter&{kill:ReturnType<typeof vi.fn>})[]=[],spawn=vi.fn((binary:string,args:string[],options:unknown)=>{void binary;void args;void options;const child=Object.assign(new EventEmitter(),{kill:vi.fn()});children.push(child);return child;}),unref=vi.fn(),schedule=vi.fn((callback:()=>void,delay:number)=>{void callback;void delay;return {unref};}),cancel=vi.fn();
 return {host,children,spawn,schedule,cancel};
}

function tripFixture(){const f=fixture();Object.assign(f.host.env,{LS_ACADEMY_TRIP390_ACK_ENABLED:'true',LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON:JSON.stringify({version:'JLFA-TRIP390-ACK-ADMISSION-v2',population:{mode:'controlled_test'},notBefore:'2035-01-01T11:00:00.000Z',admittedAt:'2035-01-01T12:00:00.000Z',expiresAt:'2035-01-01T14:00:00.000Z'}),LS_ACADEMY_TRIP390_ACK_QUEUE_ENABLED:'true',LS_INQUIRY_EMAIL_QUEUE_ENABLED:'false',LS_INQUIRY_EMAIL_SEND_ENABLED:'false',LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:'office@bneineviimacademy.org'});return {...f,now:()=>Date.parse('2035-01-01T12:00:00.000Z')};}
it('Trip ACK uses only its dedicated TS worker, leaving generic and founder modes closed',()=>{const f=tripFixture(),app=startApplication(f);expect(f.spawn).toHaveBeenCalledTimes(2);expect(f.spawn.mock.calls[1]?.[1]).toEqual(['--conditions=react-server','--import','tsx',expect.stringContaining('inquiry-email-worker.ts'),'--hosted-trip390-ack']);app.stop();for(const child of f.children)child.emit('exit',0);});
it.each(['expired','global-on','missing-policy'] as const)('Trip ACK %s remains closed without taking down the website',mode=>{const f=tripFixture();if(mode==='expired')f.now=()=>Date.parse('2035-01-01T14:00:00.000Z');if(mode==='global-on')f.host.env.LS_INQUIRY_EMAIL_SEND_ENABLED='true';if(mode==='missing-policy')delete f.host.env.LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON;const app=startApplication(f);expect(f.spawn).toHaveBeenCalledTimes(1);app.stop();for(const child of f.children)child.emit('exit',0);});
it('Trip worker expiry/failure leaves saved inquiries and web available; shutdown still owns all children',()=>{const f=tripFixture(),app=startApplication(f);f.children[1]!.emit('exit',0);expect(f.children[0]!.kill).not.toHaveBeenCalled();expect(f.host.exitCode).toBe(0);app.stop();expect(f.children[0]!.kill).toHaveBeenCalledWith('SIGTERM');f.children[0]!.emit('exit',0);});
it('disabled default starts only existing Next without worker or timer',()=>{
 const f=fixture();startApplication(f);expect(f.spawn).toHaveBeenCalledTimes(1);expect(f.spawn.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['start','--port','3010']));expect(f.schedule).not.toHaveBeenCalled();f.children[0]!.emit('exit',0);expect(f.host.listenerCount('SIGTERM')).toBe(0);
});
it('incomplete enabled policy closes before any child starts',()=>{
 const f=fixture(true);delete f.host.env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON;expect(()=>startApplication(f)).toThrow('SIGNUP_WORKER_NOT_ADMITTED');expect(f.spawn).not.toHaveBeenCalled();expect(f.host.listenerCount('SIGTERM')).toBe(0);
});
it('enabled worker uses existing tsx path, no secrets in arguments, one child each',()=>{
 const f=fixture(true);const app=startApplication(f);expect(f.spawn).toHaveBeenCalledTimes(2);expect(f.spawn.mock.calls[1]?.[1]).toEqual(['--conditions=react-server','--import','tsx',expect.stringContaining('inquiry-email-worker.ts'),'--hosted-signup']);expect(JSON.stringify(f.spawn.mock.calls.map(c=>c.slice(0,2)))).not.toContain('synthetic-private-policy');app.stop();for(const child of f.children)child.emit('exit',0);
});
it('unexpected worker failure stops web and bounds its shutdown without spawning replacements',()=>{
 const f=fixture(true);startApplication(f);f.children[1]!.emit('exit',1);expect(f.host.exitCode).toBe(1);expect(f.children[0]!.kill).toHaveBeenCalledWith('SIGTERM');expect(f.schedule).toHaveBeenCalledWith(expect.any(Function),10000);const hard=f.schedule.mock.calls[0]?.[0] as unknown as ()=>void;hard();expect(f.children[0]!.kill).toHaveBeenCalledWith('SIGKILL');f.children[0]!.emit('exit',0);expect(f.cancel).toHaveBeenCalledTimes(1);expect(f.host.listenerCount('SIGTERM')).toBe(0);expect(f.spawn).toHaveBeenCalledTimes(2);
});
it('web exit stops worker; repeated shutdown does not reschedule or orphan',()=>{
 const f=fixture(true);startApplication(f);f.children[0]!.emit('exit',0);f.host.emit('SIGTERM');expect(f.children[1]!.kill).toHaveBeenCalledTimes(1);expect(f.schedule).toHaveBeenCalledTimes(1);f.children[1]!.emit('exit',0);expect(f.host.listenerCount('SIGINT')).toBe(0);
});
it('synchronous spawn failure is normalized and stops the existing child',()=>{
 const f=fixture(true);f.spawn.mockImplementationOnce(()=>{const child=Object.assign(new EventEmitter(),{kill:vi.fn()});f.children.push(child);return child;}).mockImplementationOnce(()=>{throw Error('private launch detail');});expect(()=>startApplication(f)).toThrow('APPLICATION_CHILD_START_FAILED');expect(f.children[0]!.kill).toHaveBeenCalledWith('SIGTERM');f.children[0]!.emit('exit',0);
});

it('owner notifications require the exact admitted address and launch one supervised worker',()=>{
 const f=fixture();Object.assign(f.host.env,{LS_ACADEMY_OWNER_NOTIFICATION_ENABLED:'true',LS_ACADEMY_OWNER_NOTIFICATION_TO:'sdratler@gmail.com',LS_INQUIRY_EMAIL_QUEUE_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:'office@bneineviimacademy.org'});
 startApplication(f);expect(f.spawn).toHaveBeenCalledTimes(2);expect(f.spawn.mock.calls[1]?.[1]).toEqual(['--conditions=react-server','--import','tsx',expect.stringContaining('academy-owner-notification-worker.ts'),'--hosted-owner-notifications']);
 f.children[1]!.emit('exit',0);expect(f.host.exitCode).toBe(1);expect(f.children[0]!.kill).toHaveBeenCalledWith('SIGTERM');f.children[0]!.emit('exit',0);
});
it('owner notifications reject any destination or transport drift before startup',()=>{
 for(const change of [{LS_ACADEMY_OWNER_NOTIFICATION_TO:'other@example.com'},{LS_AUTH_EMAIL_PROVIDER:'console'},{LS_AUTH_EMAIL_FROM:'other@example.com'}]){const f=fixture();Object.assign(f.host.env,{LS_ACADEMY_OWNER_NOTIFICATION_ENABLED:'true',LS_ACADEMY_OWNER_NOTIFICATION_TO:'sdratler@gmail.com',LS_INQUIRY_EMAIL_QUEUE_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:'office@bneineviimacademy.org',...change});expect(()=>startApplication(f)).toThrow('OWNER_NOTIFICATION_NOT_ADMITTED');expect(f.spawn).not.toHaveBeenCalled();}
});

function controlledStart(){const f=fixture(true);f.host.env.LS_INQUIRY_EMAIL_SEND_ENABLED='false';delete f.host.env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED;f.host.env.LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED='true';f.host.env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON=JSON.stringify({population:{mode:'controlled_test'},expiresAt:'2026-10-27T13:00:00.000Z'});return f;}
it('planned controlled expiry leaves Next running and its normal shutdown handlers active',()=>{
 const f=controlledStart();let at=Date.parse('2026-10-27T12:00:00.000Z');const app=startApplication({...f,now:()=>at});
 expect(f.spawn).toHaveBeenCalledTimes(2);expect(f.spawn.mock.calls[1]?.[2]).toMatchObject({stdio:['inherit','inherit','inherit','ipc']});
 at=Date.parse('2026-10-27T13:00:00.000Z');f.children[1]!.emit('message',{type:'JLFA_SIGNUP_WORKER_COMPLETE',reason:'ADMISSION_EXPIRED'});f.children[1]!.emit('exit',0);
 expect(f.children[0]!.kill).not.toHaveBeenCalled();expect(f.schedule).not.toHaveBeenCalled();expect(f.host.listenerCount('SIGTERM')).toBe(1);expect(f.host.exitCode).toBe(0);
 app.stop();expect(f.children[0]!.kill).toHaveBeenCalledWith('SIGTERM');f.children[0]!.emit('exit',0);expect(f.host.listenerCount('SIGTERM')).toBe(0);
});
it('restart after finite expiry starts only Next without an email crash loop',()=>{
 const f=controlledStart(),app=startApplication({...f,now:()=>Date.parse('2026-10-27T13:00:00.000Z')});expect(f.spawn).toHaveBeenCalledTimes(1);expect(f.schedule).not.toHaveBeenCalled();app.stop();f.children[0]!.emit('exit',0);
});
it.each(['unexpected-zero','early-expiry','failed-expiry'] as const)('worker %s still supervises failure rather than silently losing it',mode=>{
 const f=controlledStart();let at=Date.parse('2026-10-27T12:00:00.000Z');startApplication({...f,now:()=>at});
 if(mode==='failed-expiry')at=Date.parse('2026-10-27T13:00:00.000Z');
 if(mode!=='unexpected-zero')f.children[1]!.emit('message',{type:'JLFA_SIGNUP_WORKER_COMPLETE',reason:'ADMISSION_EXPIRED'});
 f.children[1]!.emit('exit',mode==='failed-expiry'?1:0);expect(f.children[0]!.kill).toHaveBeenCalledWith('SIGTERM');expect(f.host.exitCode).toBe(1);f.children[0]!.emit('exit',0);
});
it('controlled flag cannot start a broad worker or turn generic SEND on',()=>{
 for(const change of [{LS_INQUIRY_EMAIL_SEND_ENABLED:'true'},{LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:JSON.stringify({population:{mode:'future_submissions'}})}]){const f=controlledStart();Object.assign(f.host.env,change);expect(()=>startApplication({...f,now:()=>Date.parse('2026-10-27T12:00:00.000Z')})).toThrow('SIGNUP_WORKER_NOT_ADMITTED');expect(f.spawn).not.toHaveBeenCalled();}
});

it('BNA acknowledgment worker failure leaves public intake running and does not restart or resend',()=>{
 const f=fixture();f.host.env.LS_BNA_EMAIL_WORKER_ENABLED='true';const app=startApplication(f);
 expect(f.spawn).toHaveBeenCalledTimes(2);expect(f.spawn.mock.calls[1]?.[1]).toEqual(['--conditions=react-server','--import','tsx',expect.stringContaining('bna-acknowledgment-worker.ts'),'--hosted-bna-acknowledgments']);
 f.children[1]!.emit('exit',1);expect(f.children[0]!.kill).not.toHaveBeenCalled();expect(f.host.exitCode).toBe(0);expect(f.spawn).toHaveBeenCalledTimes(2);
 app.stop();f.children[0]!.emit('exit',0);expect(f.host.listenerCount('SIGTERM')).toBe(0);
});
it('reply monitor starts only with its own flag, preserves web on failure, and stops with the web child',()=>{
 const f=fixture();f.host.env.LS_BNA_REPLY_MONITOR_ENABLED='true';const app=startApplication(f);
 expect(f.spawn).toHaveBeenCalledTimes(2);expect(f.spawn.mock.calls[1]?.[1]).toEqual(['--conditions=react-server','--import','tsx',expect.stringContaining('bna-reply-monitor-worker.ts'),'--hosted-bna-reply-monitor']);
 f.children[1]!.emit('exit',1);expect(f.children[0]!.kill).not.toHaveBeenCalled();expect(f.host.exitCode).toBe(0);expect(f.spawn).toHaveBeenCalledTimes(2);app.stop();f.children[0]!.emit('exit',0);
 const g=fixture();g.host.env.LS_BNA_REPLY_MONITOR_ENABLED='true';startApplication(g);g.children[0]!.emit('exit',0);expect(g.children[1]!.kill).toHaveBeenCalledWith('SIGTERM');g.children[1]!.emit('exit',0);expect(g.host.listenerCount('SIGTERM')).toBe(0);
});
it('BNA worker spawn errors preserve web, while web shutdown still stops an active BNA child',()=>{
 const broken=fixture();broken.host.env.LS_BNA_EMAIL_WORKER_ENABLED='true';broken.spawn.mockImplementationOnce(()=>{const child=Object.assign(new EventEmitter(),{kill:vi.fn()});broken.children.push(child);return child;}).mockImplementationOnce(()=>{throw Error('synthetic spawn failure');});
 const app=startApplication(broken);expect(broken.children[0]!.kill).not.toHaveBeenCalled();app.stop();broken.children[0]!.emit('exit',0);
 const f=fixture();f.host.env.LS_BNA_EMAIL_WORKER_ENABLED='true';startApplication(f);f.children[0]!.emit('exit',0);expect(f.children[1]!.kill).toHaveBeenCalledWith('SIGTERM');f.children[1]!.emit('exit',0);expect(f.host.listenerCount('SIGTERM')).toBe(0);
});

it('Trip crash recovers sequentially under the same prospective purpose with bounded exponential backoff',()=>{
 const f=tripFixture();const p=JSON.parse(f.host.env.LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON!);p.population={mode:'future_requests'};p.expiresAt=null;f.host.env.LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON=JSON.stringify(p);
 f.now=()=>Date.parse('2035-04-01T12:00:00.000Z');const app=startApplication(f);
 for(let i=0;i<9;i++){
  const child=f.children.at(-1)!;child.emit('exit',1);child.emit('error',Error('duplicate termination notification'));
  expect(f.schedule).toHaveBeenCalledTimes(i+1);expect(f.schedule.mock.calls[i]![1]).toBe(Math.min(300000,5000*2**i));
  expect(f.spawn).toHaveBeenCalledTimes(i+2);f.schedule.mock.calls[i]![0]();expect(f.spawn).toHaveBeenCalledTimes(i+3);
 }
 expect(f.children[0]!.kill).not.toHaveBeenCalled();expect(f.host.env.LS_INQUIRY_EMAIL_QUEUE_ENABLED).toBe('false');
 app.stop();f.children[0]!.emit('exit',0);f.children.at(-1)!.emit('exit',0);expect(f.host.listenerCount('SIGTERM')).toBe(0);
});
it.each(['closed','flag','queue','global','policy-change','shutdown'] as const)('Trip restart cancels safely for %s without renewing authority',mode=>{
 const f=tripFixture(),app=startApplication(f);
 if(mode==='closed')f.children[1]!.emit('message',{type:'JLFA_TRIP_ACK_COMPLETE',reason:'ADMISSION_CLOSED'});
 f.children[1]!.emit('exit',1);
 if(mode==='closed'){expect(f.schedule).not.toHaveBeenCalled();}
 else{
  const retry=f.schedule.mock.calls[0]![0];
  if(mode==='flag')f.host.env.LS_ACADEMY_TRIP390_ACK_ENABLED='false';
  if(mode==='queue')f.host.env.LS_ACADEMY_TRIP390_ACK_QUEUE_ENABLED='false';
  if(mode==='global')f.host.env.LS_INQUIRY_EMAIL_SEND_ENABLED='true';
  if(mode==='policy-change')f.host.env.LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON+=' ';
  if(mode==='shutdown')app.stop();retry();expect(f.spawn).toHaveBeenCalledTimes(2);
 }
 app.stop();f.children[0]!.emit('exit',0);
});
it('finite expiry during restart backoff is not renewed',()=>{
 const f=tripFixture();let at=Date.parse('2035-01-01T13:59:59.000Z');const app=startApplication({...f,now:()=>at});
 f.children[1]!.emit('exit',1);at=Date.parse('2035-01-01T14:00:00.000Z');f.schedule.mock.calls[0]![0]();expect(f.spawn).toHaveBeenCalledTimes(2);app.stop();f.children[0]!.emit('exit',0);
});
it('Trip spawn failure retries once per scheduled attempt and stale source closure stops it',()=>{
 const f=tripFixture();f.spawn.mockImplementationOnce(()=>{const child=Object.assign(new EventEmitter(),{kill:vi.fn()});f.children.push(child);return child;}).mockImplementationOnce(()=>{throw Error('synthetic spawn failure');});
 const app=startApplication(f);expect(f.schedule.mock.calls[0]![1]).toBe(5000);expect(f.children[0]!.kill).not.toHaveBeenCalled();
 f.schedule.mock.calls[0]![0]();expect(f.spawn).toHaveBeenCalledTimes(3);f.children[1]!.emit('message',{type:'JLFA_TRIP_ACK_COMPLETE',reason:'ADMISSION_CLOSED'});f.children[1]!.emit('exit',0);expect(f.schedule).toHaveBeenCalledTimes(1);app.stop();f.children[0]!.emit('exit',0);
});
it('an error from a live Trip child does not spawn a competing replacement before exit',()=>{
 const f=tripFixture(),app=startApplication(f);Object.assign(f.children[1]!,{pid:123});f.children[1]!.emit('error',Error('synthetic'));
 expect(f.schedule).not.toHaveBeenCalled();f.children[1]!.emit('exit',1);expect(f.schedule).toHaveBeenCalledTimes(1);app.stop();f.schedule.mock.calls[0]![0]();expect(f.spawn).toHaveBeenCalledTimes(2);f.children[0]!.emit('exit',0);
});
