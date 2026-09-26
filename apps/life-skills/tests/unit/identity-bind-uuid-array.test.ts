import { describe,expect,test,vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
vi.mock('server-only',()=>({}));
import { bindStatement } from '../../src/features/identity/drizzle-store.ts';

const a='123e4567-e89b-12d3-a456-426614174000';
const b='123e4567-e89b-12d3-a456-426614174001';

describe('identity SQL binding',()=>{
 test('binds UUID arrays as one validated PostgreSQL array parameter',()=>{
  const query=new PgDialect().sqlToQuery(bindStatement('SELECT id FROM accounts WHERE workspace_id=$1 AND id=ANY($2::uuid[])',[a,[a,b]]));
  expect(query.sql).toBe('SELECT id FROM accounts WHERE workspace_id=$1 AND id=ANY($2::uuid[])');
  expect(query.params).toEqual([a,`{${a},${b}}`]);
 });
 test('supports an empty UUID array without changing the query',()=>{
  const query=new PgDialect().sqlToQuery(bindStatement('SELECT $1::uuid[]',[[]]));
  expect(query.params).toEqual(['{}']);
 });
 test('rejects malformed UUIDs and arrays without an explicit UUID cast',()=>{
  expect(()=>bindStatement('SELECT $1::uuid[]',[['bad']])).toThrow();
  expect(()=>bindStatement('SELECT $1',[[a]])).toThrow();
  expect(()=>bindStatement('SELECT $1::uuid[]',[[a,7]])).toThrow();
 });
});
