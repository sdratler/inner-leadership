import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { safeTestUrl } from '../../database/calendar/fixture.ts';

const ci='postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_migration_test';
beforeEach(()=>{
 for(const name of ['CI','TEST_DATABASE_URL','LS_MIGRATION_DATABASE_URL','LS_CALENDAR_TEST_ALLOW','LS_APP_MODE','LS_DATABASE_TLS'])vi.stubEnv(name,undefined);
});
afterEach(()=>vi.unstubAllEnvs());
it('accepts only the already migrated, exact synthetic database from the frozen repository CI contract',()=>{
 vi.stubEnv('CI','true');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_DATABASE_TLS','disable');vi.stubEnv('LS_MIGRATION_DATABASE_URL',ci);
 expect(safeTestUrl()).toBe(ci);
});
it.each([ci.replace('127.0.0.1','db.example.invalid'),ci.replace('5432','5433'),ci.replace('lifeskills_migration_test','lifeskills_ci_test'),ci+'?sslmode=disable',ci+'#extra'])('rejects a non-exact CI database: %s',url=>{
 vi.stubEnv('CI','true');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_DATABASE_TLS','disable');vi.stubEnv('LS_MIGRATION_DATABASE_URL',url);
 expect(()=>safeTestUrl()).toThrow('CALENDAR_CI_DATABASE_NOT_EXACT_DISPOSABLE_TARGET');
});
it('does not infer local permission from a migration variable or override an explicit unsafe target',()=>{
 vi.stubEnv('LS_MIGRATION_DATABASE_URL',ci);expect(()=>safeTestUrl()).toThrow('CALENDAR_TEST_DATABASE_OPT_IN_REQUIRED');
 vi.stubEnv('CI','true');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_DATABASE_TLS','disable');vi.stubEnv('TEST_DATABASE_URL','postgresql://localhost/production');
 expect(()=>safeTestUrl()).toThrow('CALENDAR_TEST_DATABASE_OPT_IN_REQUIRED');
 vi.stubEnv('LS_CALENDAR_TEST_ALLOW','true');expect(()=>safeTestUrl()).toThrow('CALENDAR_TEST_DATABASE_NOT_DISPOSABLE_LOOPBACK');
});
it('retains explicit guarded loopback opt-in for local fixtures',()=>{
 const local='postgresql://postgres@127.0.0.1:55471/ls_calendar_test_synthetic_test';vi.stubEnv('TEST_DATABASE_URL',local);
 expect(()=>safeTestUrl()).toThrow('CALENDAR_TEST_DATABASE_OPT_IN_REQUIRED');vi.stubEnv('LS_CALENDAR_TEST_ALLOW','true');expect(safeTestUrl()).toBe(local);
});
it.each([['LS_APP_MODE',undefined],['LS_APP_MODE','foundation_preview'],['LS_DATABASE_TLS',undefined],['LS_DATABASE_TLS','require']] as const)('rejects missing or wrong CI guard %s=%s',(name,value)=>{
 vi.stubEnv('CI','true');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_DATABASE_TLS','disable');vi.stubEnv('LS_MIGRATION_DATABASE_URL',ci);
 vi.stubEnv(name,value);expect(()=>safeTestUrl()).toThrow('CALENDAR_CI_DATABASE_NOT_EXACT_DISPOSABLE_TARGET');
});
