/** Test-only environment guard. Returns no DSN; callers still construct new PGlite().
 * The sole CI exception mirrors the protected workflow's secret-free loopback
 * pair, not calendar's separate migrated database or any provider connection.
 */
const protectedCiUrl='postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_ci_test';
export function requirePgliteMemoryEnvironment(env:Readonly<Record<string,string|undefined>>):void{
 if(env.NODE_ENV!=='test')throw Error('PGLITE_MEMORY_TEST_ENVIRONMENT_REQUIRED');
 const app=env.LS_DATABASE_URL,test=env.LS_TEST_DATABASE_URL,direct=env.DATABASE_URL;
 if(app===undefined&&test===undefined&&direct===undefined)return;
 // DATABASE_URL is not set by this protected workflow. No alternate target,
 // normalization, credentials, query options or ambient direct URL is allowed.
 if(env.CI!=='true'||direct!==undefined||app!==protectedCiUrl||test!==protectedCiUrl)
  throw Error('PGLITE_MEMORY_EXTERNAL_DATABASE_ENVIRONMENT_DENIED');
}
