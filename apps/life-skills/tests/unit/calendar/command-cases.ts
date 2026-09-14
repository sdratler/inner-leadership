import assert from 'node:assert/strict';
import { AppError } from '../../../src/lib/errors.ts';
import { CalendarStore } from '../../../src/features/calendar/store.ts';
import type { IdentityStore,SqlSession } from '../../../src/features/identity/store.ts';
import type { Register } from './cases.ts';
import { actor, practitioner } from './fixtures.ts';
/** Deliberately scoped transactional fake. It tests the real command wrapper, not PostgreSQL SQL semantics. */
class MemoryStore implements IdentityStore {
 commands=new Map<string,{digest:string;result:string}>();effects=0;authorized=true;tail=Promise.resolve();
 async transaction<T>(work:(tx:SqlSession)=>Promise<T>):Promise<T>{
  let release:()=>void=()=>{};const previous=this.tail;this.tail=new Promise<void>(r=>{release=r;});await previous;
  const saved=new Map(this.commands),effects=this.effects;
  const tx:SqlSession={query:async <R extends object>(statement:string,values:readonly unknown[]=[]):Promise<R[]>=>{
   let rows:object[]=[];
   if(statement.startsWith('SELECT id FROM ls_identity.workspaces'))rows=[{id:actor.workspaceId}];
   else if(statement.startsWith('SELECT a.id FROM ls_identity.sessions'))rows=this.authorized?[{id:actor.id}]:[];
   else if(statement.startsWith('SELECT a.id,a.workspace_id'))rows=[{...practitioner,emailBlind:'b'.repeat(64),emailCiphertext:'synthetic',emailVerifiedAt:new Date('2026-09-01'),passwordHash:'synthetic-only',phoneCiphertext:null,phoneVerifiedAt:null}];
   else if(statement==='SELECT clock_timestamp() AS now')rows=[{now:new Date('2026-09-07T12:00:00Z')}];
   else if(statement.startsWith('SELECT body_digest')){const r=this.commands.get(values.slice(0,4).join('|'));if(r)rows=[r];}
   else if(statement.startsWith('INSERT INTO ls_calendar.commands'))this.commands.set(values.slice(0,4).join('|'),{digest:String(values[4]),result:String(values[5])});
   else if(statement==='SYNTHETIC_EFFECT'){this.effects++;rows=[{value:this.effects}];}
   else throw new Error('Unexpected SQL in narrow fake');
   return rows as R[];
  }};
  try{return await work(tx);}catch(e){this.commands=saved;this.effects=effects;throw e;}finally{release();}
 }
}
function setup(){const memory=new MemoryStore();const calendar=new CalendarStore(memory,{activeKeyId:'synthetic-test-only',keys:{'synthetic-test-only':Buffer.alloc(32,7)}},{now:()=>new Date('2026-09-07T12:00:00Z')});return {memory,calendar};}
const key='synthetic-command-key-0001';
export function registerCommandTests(test:Register){
 test('real command wrapper replays one encrypted result without a second effect',async()=>{const {memory,calendar}=setup();const work=async(c:Parameters<Parameters<CalendarStore['read']>[1]>[0])=>{await c.tx.query('SYNTHETIC_EFFECT');return {receipt:'synthetic-receipt'};};const a=await calendar.command(actor,'synthetic',key,{a:1},async()=>{},work);const b=await calendar.command(actor,'synthetic',key,{a:1},async()=>{},work);assert.deepEqual(a,b);assert.equal(memory.effects,1);assert.equal(memory.commands.size,1);assert.ok(![...memory.commands.values()][0]!.result.includes('synthetic-receipt'));});
 test('same key with a different payload conflicts without a second effect',async()=>{const {memory,calendar}=setup();await calendar.command(actor,'synthetic',key,{a:1},async()=>{},async c=>{await c.tx.query('SYNTHETIC_EFFECT');return 1;});await assert.rejects(calendar.command(actor,'synthetic',key,{a:2},async()=>{},async()=>2),(e:unknown)=>e instanceof AppError&&e.code==='CONFLICT');assert.equal(memory.effects,1);});
 test('authorization is checked before replaying a cached response',async()=>{const {calendar}=setup();await calendar.command(actor,'synthetic',key,{},async()=>{},async()=>({private:'synthetic'}));await assert.rejects(calendar.command(actor,'synthetic',key,{},async()=>{throw new AppError('NOT_FOUND');},async()=>({private:'unreachable'})),(e:unknown)=>e instanceof AppError&&e.code==='NOT_FOUND');});
 test('revoked server session is denied before cached command lookup',async()=>{const {memory,calendar}=setup();await calendar.command(actor,'synthetic',key,{},async()=>{},async()=>1);memory.authorized=false;await assert.rejects(calendar.command(actor,'synthetic',key,{},async()=>{},async()=>2),(e:unknown)=>e instanceof AppError&&e.code==='UNAUTHENTICATED');});
 test('a failed command rolls back both the effect and the replay record',async()=>{const {memory,calendar}=setup();await assert.rejects(calendar.command(actor,'synthetic',key,{},async()=>{},async c=>{await c.tx.query('SYNTHETIC_EFFECT');throw new AppError('CONFLICT');}));assert.equal(memory.effects,0);assert.equal(memory.commands.size,0);});
 test('concurrent retries of the real wrapper converge under a serialized transaction fake',async()=>{const {memory,calendar}=setup();const results=await Promise.all(Array.from({length:20},()=>calendar.command(actor,'synthetic',key,{a:1},async()=>{},async c=>{await c.tx.query('SYNTHETIC_EFFECT');return {value:memory.effects};})));assert.ok(results.every(r=>r.value===1));assert.equal(memory.effects,1);assert.equal(memory.commands.size,1);});
 test('idempotency key is operation scoped',async()=>{const {memory,calendar}=setup();for(const operation of ['a','b'])await calendar.command(actor,operation,key,{},async()=>{},async c=>{await c.tx.query('SYNTHETIC_EFFECT');return 1;});assert.equal(memory.effects,2);});
 test('invalid or missing idempotency key is rejected before a transaction',async()=>{const {memory,calendar}=setup();await assert.rejects(calendar.command(actor,'synthetic','short',{},async()=>{},async()=>1),(e:unknown)=>e instanceof AppError&&e.code==='INVALID_REQUEST');assert.equal(memory.commands.size,0);});
}
