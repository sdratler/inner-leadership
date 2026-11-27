import {afterEach,expect,test,vi} from "vitest";
import {createHash} from 'node:crypto';
const fixture=vi.hoisted(()=>({url:"postgresql://synthetic:synthetic-only@127.0.0.1:5440/target_a_test",tls:"disable",ca:'synthetic CA',pools:[]as {options:Record<string,unknown>;queries:number;ended:boolean}[]}));
vi.mock("server-only",()=>({}));
vi.mock("../../../src/lib/env/server.ts",()=>({serverEnvironment:()=>({LS_DATABASE_URL:fixture.url,LS_DATABASE_TLS:fixture.tls,LS_DATABASE_CA:fixture.ca})}));
vi.mock("pg",()=>({Pool:class{
 options:Record<string,unknown>;record:{options:Record<string,unknown>;queries:number;ended:boolean};
 constructor(options:Record<string,unknown>){this.options={...options};this.record={options:this.options,queries:0,ended:false};fixture.pools.push(this.record);}
 on(){return this;}async end(){this.record.ended=true;}
}}));
vi.mock("drizzle-orm/node-postgres",()=>({drizzle:(pool:{record:{options:Record<string,unknown>;queries:number;ended:boolean}})=>({
 transaction:async(work:(tx:{execute:()=>Promise<{rows:unknown[];fields:unknown[]}>})=>Promise<unknown>)=>{
  if(pool.record.ended)throw Error("SYNTHETIC_CLOSED_POOL");return work({execute:async()=>{pool.record.queries++;return {rows:[{syntheticTarget:pool.record.options.connectionString}],fields:[]};}});
 }
})}));
import {database,databaseBoundToTarget,databaseBoundToFishingTarget,closeDatabase} from "../../../src/db/client.ts";
import {drizzleIdentityStore} from "../../../src/features/identity/drizzle-store.ts";
afterEach(async()=>{await closeDatabase();fixture.url="postgresql://synthetic:synthetic-only@127.0.0.1:5440/target_a_test";fixture.tls="disable";fixture.ca='synthetic CA';fixture.pools=[];});
test("cached original A cannot be restamped as B before composition; no SQL or replacement pool",()=>{
 const a=fixture.url;database();fixture.url=a.replace("target_a","target_b");
 expect(databaseBoundToTarget(fixture.url)).toBeNull();expect(drizzleIdentityStore.bindDatabaseTarget?.(fixture.url)).toBeNull();
 expect(fixture.pools).toHaveLength(1);expect(fixture.pools[0]!.options.connectionString).toBe(a);expect(fixture.pools[0]!.queries).toBe(0);
});
test("matching actual initialized target yields a fixed-bound normal store, never later env target",async()=>{
 const a=fixture.url,bound=drizzleIdentityStore.bindDatabaseTarget?.(a);expect(bound).not.toBeNull();
 fixture.url=a.replace("target_a","target_b");
 expect(await bound!.transaction(tx=>tx.query("SELECT 'synthetic only'"))).toEqual([{syntheticTarget:a}]);
 expect(fixture.pools).toHaveLength(1);expect(fixture.pools[0]!.queries).toBe(1);expect(drizzleIdentityStore.bindDatabaseTarget?.(fixture.url)).toBeNull();
});
test("missing initial match and incompatible original TLS cannot establish a bound driver",()=>{
 expect(databaseBoundToTarget(fixture.url.replace("target_a","other"))).toBeNull();expect(fixture.pools).toHaveLength(0);
 fixture.tls="verify";expect(databaseBoundToTarget(fixture.url)).toBeNull();expect(fixture.pools).toHaveLength(0);
 database();fixture.tls="disable";expect(databaseBoundToTarget(fixture.url)).toBeNull();expect(fixture.pools).toHaveLength(1);expect(fixture.pools[0]!.queries).toBe(0);
});
test("closing a bound pool cannot silently retarget its retained store to another pool",async()=>{
 const a=fixture.url,bound=drizzleIdentityStore.bindDatabaseTarget?.(a);await closeDatabase();fixture.url=a.replace("target_a","target_b");
 await expect(bound!.transaction(tx=>tx.query("SELECT 'synthetic only'"))).rejects.toThrow("SYNTHETIC_CLOSED_POOL");
 expect(fixture.pools).toHaveLength(1);expect(fixture.pools[0]!.queries).toBe(0);
});
const caHash=()=>createHash('sha256').update(fixture.ca).digest('hex');
test('Fishing release capability requires strict original TLS and pinned CA without changing rehearsal behavior',async()=>{
 fixture.tls='verify-full';const expected=caHash(),a=fixture.url;
 expect(databaseBoundToTarget(a)).toBeNull();expect(fixture.pools).toHaveLength(0);
 const bound=drizzleIdentityStore.bindFishingDatabaseTarget?.(a,expected);expect(bound).not.toBeNull();
 expect(fixture.pools[0]!.options.ssl).toEqual({rejectUnauthorized:true,ca:'synthetic CA'});expect(fixture.pools[0]!.queries).toBe(0);
 fixture.url=a.replace('target_a','target_b');fixture.ca='different synthetic CA';
 expect(databaseBoundToFishingTarget(fixture.url,caHash())).toBeNull();
 expect(databaseBoundToFishingTarget(a,caHash())).toBeNull();
 expect(await bound!.transaction(tx=>tx.query("SELECT 'synthetic only'"))).toEqual([{syntheticTarget:a}]);
 expect(fixture.pools).toHaveLength(1);
});
test('Fishing cannot promote an already initialized disabled-TLS pool or invent an unpinned CA',()=>{
 const a=fixture.url;database();fixture.tls='verify-full';
 expect(databaseBoundToFishingTarget(a,caHash())).toBeNull();expect(fixture.pools).toHaveLength(1);expect(fixture.pools[0]!.queries).toBe(0);
});
test('Fishing missing CA and incorrect initial DSN/CA pins create no pool or SQL',()=>{
 fixture.tls='verify-full';
 expect(databaseBoundToFishingTarget(fixture.url,'0'.repeat(64))).toBeNull();
 expect(databaseBoundToFishingTarget(fixture.url.replace('target_a','other'),caHash())).toBeNull();
 fixture.ca='';expect(databaseBoundToFishingTarget(fixture.url,caHash())).toBeNull();expect(fixture.pools).toHaveLength(0);
});
