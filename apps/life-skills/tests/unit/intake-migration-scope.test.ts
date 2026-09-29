import {afterEach,expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {readFile as actualReadFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertIntakeMigrationScope,INTAKE_STORAGE_MIGRATIONS} from '../../src/db/intake-migration-scope.ts';
const approved=INTAKE_STORAGE_MIGRATIONS.map(([name,sha256])=>({name,sha256}));
const current=JSON.parse(readFileSync(new URL('../../migrations/manifest.json',import.meta.url),'utf8')) as {name:string;sha256:string}[];
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();vi.resetModules();});
test('intake-only scope accepts exactly the original reviewed registry through0091',()=>{
 expect(current.slice(0,11)).toEqual(approved);expect(()=>assertIntakeMigrationScope(approved)).not.toThrow();
});
test.each([
 current,approved.slice(0,-1),[...approved].reverse(),
 [...approved,{name:'0092_unreviewed.sql',sha256:'a'.repeat(64)}],
 approved.map((entry,index)=>index===10?{...entry,sha256:'0'.repeat(64)}:entry),
])('intake-only scope rejects evolved, missing, reordered or changed registry',entries=>{
 expect(()=>assertIntakeMigrationScope(entries)).toThrow('INTAKE_MIGRATION_SCOPE_MISMATCH');
});
test('actual intake entry rejects the evolved manifest before creating any database pool or calling migrate',async()=>{
 const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
 const manifestBytes=readFileSync(new URL('../../migrations/manifest.json',import.meta.url));
 const proof=Buffer.from(JSON.stringify({changeId:'LS-FIRST-PARENTS-20260916-01',scope:'private-intake-storage-only',
  projectId:'3b756632-1f66-4f75-a016-eabc37aa0d67',serviceId:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',environmentId:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',databaseServiceId:'354b5343-9e83-45a7-b764-09396f14ae29',
  reviewedCommit:'a'.repeat(40),manifestSha256:hash(manifestBytes),independentReview:'PASS',reviewReceiptSha256:'b'.repeat(64),backupId:'synthetic-proof',backupReadbackSha256:'c'.repeat(64),isolatedRestore:'PASS',restoreReceiptSha256:'d'.repeat(64),consentConfigurationSha256:hash('synthetic-consent'),retentionPolicyRecorded:true,controlFence:'synthetic-fence-for-unit-only',expiresAt:'2099-01-01T00:00:00Z'}));
 for(const [key,value] of Object.entries({LS_INTAKE_STORAGE_RELEASE_APPROVED:'true',RAILWAY_PROJECT_ID:'3b756632-1f66-4f75-a016-eabc37aa0d67',RAILWAY_SERVICE_ID:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',RAILWAY_ENVIRONMENT_ID:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',LS_DATABASE_TLS:'verify-full',LS_DATABASE_CA:'synthetic-no-connection-ca',LS_DATABASE_URL:'postgresql://synthetic:synthetic@postgres.railway.internal:5432/railway',LS_INTAKE_RELEASE_PROOF_FILE:'synthetic-unit-proof.json',LS_INTAKE_RELEASE_PROOF_SHA256:hash(proof),LS_INTAKE_PUBLIC_CONSENT_JSON:'synthetic-consent'}))vi.stubEnv(key,value);
 const pool=vi.fn(function(){return {connect:async()=>({query:async()=>({rows:[{ssl:true}]}),release:()=>undefined}),end:async()=>undefined};});
 const migrate=vi.fn(async()=>({applied:0,pending:0}));
 vi.doMock('pg',()=>({Pool:pool}));
 vi.doMock('../../src/db/migration-runner.ts',()=>({migrate}));
 vi.doMock('../../src/features/forms/pre-enrollment/release-provenance.ts',()=>({verifyReleaseSourceProvenance:async()=>undefined}));
 vi.doMock('node:fs/promises',async()=>({...await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'),readFile:async(path:Parameters<typeof actualReadFile>[0],...args:unknown[])=>path==='synthetic-unit-proof.json'?proof:actualReadFile(path,...args as [])}));
 const stderr=vi.spyOn(process.stderr,'write').mockImplementation(()=>true),stdout=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
 const argv=process.argv,exitCode=process.exitCode;
 try{
  process.argv=['node','release-intake.ts','--apply'];
  await import('../../scripts/release-intake.ts');
  await vi.waitFor(()=>expect(stderr.mock.calls.length+stdout.mock.calls.length).toBeGreaterThan(0));
  expect(stderr).toHaveBeenCalledWith('INTAKE_STORAGE_RELEASE_BLOCKED_OR_FAILED\n');
  expect(pool).not.toHaveBeenCalled();expect(migrate).not.toHaveBeenCalled();
 }finally{
  process.argv=argv;process.exitCode=exitCode;
  vi.doUnmock('pg');vi.doUnmock('../../src/db/migration-runner.ts');vi.doUnmock('../../src/features/forms/pre-enrollment/release-provenance.ts');vi.doUnmock('node:fs/promises');
 }
});
