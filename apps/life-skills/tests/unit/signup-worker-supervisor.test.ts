import {describe,it,expect} from 'vitest';
import {superviseSignupWorker,type SignupWorkerEvent} from '../../scripts/signup-worker-supervisor.ts';
describe('pure signup worker lifecycle',()=>{
 it('awaits serial cycles and stops without overlapping work',async()=>{
  const c=new AbortController(),events:SignupWorkerEvent[]=[];let calls=0,active=0,max=0;
  await superviseSignupWorker({signal:c.signal,cycle:async()=>{calls++;active++;max=Math.max(max,active);await Promise.resolve();active--;},wait:async()=>{if(calls===3)c.abort();},event:e=>events.push(e)});
  expect(calls).toBe(3);expect(max).toBe(1);expect(events.at(-1)).toEqual({state:'STOPPED'});
 });
 it('shutdown during a cycle waits for its outcome and launches no retry',async()=>{
  const c=new AbortController();let release!:()=>void,completed=false,calls=0,waits=0;
  const pending=superviseSignupWorker({signal:c.signal,cycle:async()=>{calls++;await new Promise<void>(r=>{release=r;});completed=true;},wait:async()=>{waits++;}});
  c.abort();await Promise.resolve();expect(completed).toBe(false);release();await pending;
  expect(calls).toBe(1);expect(waits).toBe(0);expect(completed).toBe(true);
 });
 it('backs off failures within bounds without logging private errors',async()=>{
  const c=new AbortController(),delays:number[]=[],events:SignupWorkerEvent[]=[];let calls=0;
  await superviseSignupWorker({signal:c.signal,intervalMs:1000,maxBackoffMs:4000,cycle:async()=>{calls++;throw Error('private provider payload');},wait:async d=>{delays.push(d);if(calls===5)c.abort();},event:e=>events.push(e)});
  expect(delays).toEqual([1000,2000,4000,4000,4000]);expect(JSON.stringify(events)).not.toMatch(/private|payload/);
 });
 it('resets backoff after recovery',async()=>{
  const c=new AbortController(),delays:number[]=[];let calls=0;
  await superviseSignupWorker({signal:c.signal,intervalMs:1000,maxBackoffMs:4000,cycle:async()=>{calls++;if(calls<3)throw Error();},wait:async d=>{delays.push(d);if(calls===3)c.abort();}});
  expect(delays).toEqual([1000,2000,1000]);
 });
 it('does no work when stopped and rejects invalid bounds before a cycle',async()=>{
  const c=new AbortController();c.abort();let calls=0;const options={signal:c.signal,cycle:async()=>{calls++;},wait:async()=>{}};
  await superviseSignupWorker(options);for(const intervalMs of [0,999,300001,NaN])await expect(superviseSignupWorker({...options,intervalMs})).rejects.toThrow('INVALID_SIGNUP_WORKER_CONFIG');expect(calls).toBe(0);
 });
 it('handles abort during an injected wait without another cycle',async()=>{
  const c=new AbortController();let calls=0;const events:SignupWorkerEvent[]=[];
  await superviseSignupWorker({signal:c.signal,cycle:async()=>{calls++;},wait:async()=>{c.abort();throw Error('abort detail');},event:e=>events.push(e)});
  expect(calls).toBe(1);expect(events.at(-1)).toEqual({state:'STOPPED'});
 });
 it('stops on a broken wait without a tight retry loop or private error output',async()=>{
  const c=new AbortController();let calls=0;
  await expect(superviseSignupWorker({signal:c.signal,cycle:async()=>{calls++;},wait:async()=>{throw Error('private wait');}})).rejects.toThrow('SIGNUP_WORKER_WAIT_FAILED');expect(calls).toBe(1);
 });
 it('does not misreport a successful cycle as a retryable failure when event output breaks',async()=>{
  const c=new AbortController();let calls=0,waits=0;
  await expect(superviseSignupWorker({signal:c.signal,cycle:async()=>{calls++;},wait:async()=>{waits++;},event:()=>{throw Error('private logger');}})).rejects.toThrow('SIGNUP_WORKER_EVENT_FAILED');expect(calls).toBe(1);expect(waits).toBe(0);
 });
});
