/** Pure disposable-target guard shared by native and browser fixtures. */
export function safeTestUrl():string {
 const raw=process.env.TEST_DATABASE_URL;
 // The frozen, secret-free repository CI already migrates this separate database.
 // Foundation tests use their own EMPTY LS_TEST_DATABASE_URL; never reuse that DB here.
 // No general fallback, remote host, provider credential or additional CI write is admitted.
 if(!raw&&process.env.CI==='true'){
  const ci=process.env.LS_MIGRATION_DATABASE_URL;
  if(process.env.LS_APP_MODE!=='foundation_locked'||process.env.LS_DATABASE_TLS!=='disable'||
   ci!=='postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_migration_test')throw new Error('CALENDAR_CI_DATABASE_NOT_EXACT_DISPOSABLE_TARGET');
  return ci;
 }
 if(!raw||process.env.LS_CALENDAR_TEST_ALLOW!=='true')throw new Error('CALENDAR_TEST_DATABASE_OPT_IN_REQUIRED');
 let url:URL;try{url=new URL(raw);}catch{throw new Error('CALENDAR_TEST_DATABASE_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\/ls_calendar_test_[A-Za-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw new Error('CALENDAR_TEST_DATABASE_NOT_DISPOSABLE_LOOPBACK');
 return raw;
}
