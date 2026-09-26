import {describe,expect,it} from 'vitest';
import {prospectReadFailure} from '../../../src/features/prospects/api-error.ts';

describe('private CRM read failures',()=>{
 it('identifies expired sessions and denied roles without reporting a CRM outage',()=>{
  expect(prospectReadFailure(401,{ok:false,error:{code:'UNAUTHENTICATED'}})).toBe('auth');
  expect(prospectReadFailure(403,{ok:false,error:{code:'FORBIDDEN'}})).toBe('forbidden');
  expect(prospectReadFailure(401,null)).toBe('auth');
  expect(prospectReadFailure(403,null)).toBe('forbidden');
 });
 it('retains actual provider, proxy, and malformed-response failures as retryable errors',()=>{
  expect(prospectReadFailure(503,{ok:false,error:{code:'UNAVAILABLE'}})).toBe('error');
  expect(prospectReadFailure(502,'Bad gateway')).toBe('error');
  expect(prospectReadFailure(200,{ok:false,error:{code:'INTERNAL'}})).toBe('error');
 });
});
