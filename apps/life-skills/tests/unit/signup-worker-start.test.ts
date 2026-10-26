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
