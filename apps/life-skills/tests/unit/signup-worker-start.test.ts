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
