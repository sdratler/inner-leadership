import {expect,it} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
const url='postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_ci_test';
const ci={NODE_ENV:'test',CI:'true',LS_DATABASE_URL:url,LS_TEST_DATABASE_URL:url};
it('permits isolated memory with no primary database URLs and returns no connection value',()=>{
 expect(requirePgliteMemoryEnvironment({NODE_ENV:'test'})).toBeUndefined();
 expect(requirePgliteMemoryEnvironment({NODE_ENV:'test',CI:'true'})).toBeUndefined();
});
it('permits only the exact protected synthetic CI pair without consuming it',()=>{
 const frozen=Object.freeze({...ci});expect(requirePgliteMemoryEnvironment(frozen)).toBeUndefined();expect(frozen).toEqual(ci);
});
it.each([
 {...ci,NODE_ENV:'production'}, {...ci,NODE_ENV:undefined}, {...ci,CI:'false'}, {...ci,CI:undefined},
 {...ci,LS_TEST_DATABASE_URL:undefined}, {...ci,LS_DATABASE_URL:undefined}, {...ci,DATABASE_URL:url},
 {...ci,DATABASE_URL:'postgresql://secret@production.invalid/app'}, {...ci,DATABASE_URL:''},
 {...ci,LS_DATABASE_URL:''}, {...ci,LS_TEST_DATABASE_URL:''},
 {NODE_ENV:'production'}, {NODE_ENV:'test',LS_TEST_DATABASE_URL:url},
 ...['postgresql://secret@production.invalid/app',url.replace('127.0.0.1','localhost'),url.replace(':5432',':5433'),url.replace('lifeskills_ci_test','lifeskills_migration_test'),url+'?sslmode=require',url+'#fragment',url.replace('synthetic_ci_only','other')].flatMap(value=>[
  {...ci,LS_DATABASE_URL:value,LS_TEST_DATABASE_URL:value},{...ci,LS_TEST_DATABASE_URL:value},
 ]),
])('refuses non-test, missing, mismatched, external or altered database environment %#',env=>{
 expect(()=>requirePgliteMemoryEnvironment(env)).toThrow();
});
